import fetch from 'node-fetch';
import crypto from 'node:crypto';
import kebabCase from 'lodash.kebabcase';

const DEFAULT_PASSWORD = '123456';

// OAuth 提供商配置
const PROVIDERS = {
    github: {
        authUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        userInfoUrl: 'https://api.github.com/user',
        scope: 'read:user',
    },
    discord: {
        authUrl: 'https://discord.com/api/oauth2/authorize',
        tokenUrl: 'https://discord.com/api/oauth2/token',
        userInfoUrl: 'https://discord.com/api/users/@me',
        scope: 'identify guilds guilds.members.read',
    },
    linuxdo: {
        // Linux.do 使用 connect.linux.do 域名作为 OAuth 端点
        authUrl: 'https://connect.linux.do/oauth2/authorize',
        tokenUrl: 'https://connect.linux.do/oauth2/token',
        userInfoUrl: 'https://connect.linux.do/api/user',
        scope: 'read',
    },
};

export class OAuthService {
    constructor(config) {
        this.config = config;
        this.baseUrl = config.baseRegisterUrl || config.baseUrl || 'http://localhost:3070';
        
        // 如果配置了自定义 Linux.do 端点，覆盖默认值
        if (config.LINUXDO_AUTH_URL) {
            PROVIDERS.linuxdo.authUrl = config.LINUXDO_AUTH_URL;
        }
        if (config.LINUXDO_TOKEN_URL) {
            PROVIDERS.linuxdo.tokenUrl = config.LINUXDO_TOKEN_URL;
        }
        if (config.LINUXDO_USERINFO_URL) {
            PROVIDERS.linuxdo.userInfoUrl = config.LINUXDO_USERINFO_URL;
        }
    }

    /**
     * 生成 OAuth 授权 URL
     * @param {string} provider - OAuth 提供商名称
     * @param {string} [requestBaseUrl] - 请求的基础 URL（可选，用于从请求中获取实际主机信息）
     */
    getAuthUrl(provider, requestBaseUrl = null) {
        const providerConfig = PROVIDERS[provider];
        if (!providerConfig) {
            throw new Error(`不支持的 OAuth 提供商: ${provider}`);
        }

        const clientId = this.config[`${provider.toUpperCase()}_CLIENT_ID`];
        const clientSecret = this.config[`${provider.toUpperCase()}_CLIENT_SECRET`];

        if (!clientId) {
            throw new Error(`${provider} OAuth 未配置客户端 ID`);
        }

        // 优先使用请求中的 baseUrl，否则使用配置的 baseUrl
        const baseUrl = requestBaseUrl || this.baseUrl;

        const state = crypto.randomBytes(32).toString('hex');
        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: `${baseUrl}/oauth/callback/${provider}`,
            scope: providerConfig.scope,
            state: state,
            response_type: 'code',
        });

        // Discord 需要额外的参数
        if (provider === 'discord') {
            params.set('response_type', 'code');
        }

        return {
            url: `${providerConfig.authUrl}?${params.toString()}`,
            state: state,
        };
    }

    /**
     * 交换授权码获取访问令牌
     * @param {string} provider - OAuth 提供商名称
     * @param {string} code - 授权码
     * @param {string} [requestBaseUrl] - 请求的基础 URL（可选，用于从请求中获取实际主机信息）
     */
    async exchangeCode(provider, code, requestBaseUrl = null) {
        const providerConfig = PROVIDERS[provider];
        if (!providerConfig) {
            throw new Error(`不支持的 OAuth 提供商: ${provider}`);
        }

        const clientId = this.config[`${provider.toUpperCase()}_CLIENT_ID`];
        const clientSecret = this.config[`${provider.toUpperCase()}_CLIENT_SECRET`];

        if (!clientId || !clientSecret) {
            throw new Error(`${provider} OAuth 配置不完整`);
        }

        // 优先使用请求中的 baseUrl，否则使用配置的 baseUrl
        const baseUrl = requestBaseUrl || this.baseUrl;

        const params = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code: code,
            redirect_uri: `${baseUrl}/oauth/callback/${provider}`,
            grant_type: 'authorization_code',
        });

        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
        };

        // GitHub 需要特殊的 Accept 头
        if (provider === 'github') {
            headers['Accept'] = 'application/json';
        }

        const response = await fetch(providerConfig.tokenUrl, {
            method: 'POST',
            headers: headers,
            body: params.toString(),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`获取访问令牌失败: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        return data.access_token;
    }

    /**
     * 获取用户信息
     * @param {string} provider
     * @param {string} accessToken
     * @param {Object} [discordConfig] - 动态传入的 Discord 配置 (覆盖 this.config)
     */
    async getUserInfo(provider, accessToken, discordConfig = null) {
        const providerConfig = PROVIDERS[provider];
        if (!providerConfig) {
            throw new Error(`不支持的 OAuth 提供商: ${provider}`);
        }

        const headers = {
            'Accept': 'application/json',
        };

        // 设置授权头
        if (provider === 'github') {
            headers['Authorization'] = `token ${accessToken}`;
        } else if (provider === 'discord') {
            headers['Authorization'] = `Bearer ${accessToken}`;
        } else if (provider === 'linuxdo') {
            headers['Authorization'] = `Bearer ${accessToken}`;
        }

        const response = await fetch(providerConfig.userInfoUrl, {
            method: 'GET',
            headers: headers,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`获取用户信息失败: ${response.status} ${errorText}`);
        }

        const userData = await response.json();

        // Discord 特定验证逻辑
        // 优先使用传入的 config，否则使用实例 config
        const effectiveDiscordConfig = discordConfig || this.config.discordConfig;
        
        if (provider === 'discord' && effectiveDiscordConfig?.requiredGuildId) {
            await this.verifyDiscordGuild(accessToken, effectiveDiscordConfig.requiredGuildId, effectiveDiscordConfig.minJoinDays);
        }

        return this.normalizeUserInfo(provider, userData);
    }

    /**
     * 验证 Discord 服务器成员资格
     */
    async verifyDiscordGuild(accessToken, guildId, minJoinDays) {
        try {
            const response = await fetch(`https://discord.com/api/users/@me/guilds/${guildId}/member`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
            });

            if (response.status === 404) {
                throw new Error('您不是指定 Discord 服务器的成员，无法注册。');
            }

            if (!response.ok) {
                throw new Error('无法验证 Discord 服务器成员资格。');
            }

            const memberData = await response.json();
            
            if (minJoinDays > 0 && memberData.joined_at) {
                const joinedAt = new Date(memberData.joined_at);
                const now = new Date();
                const diffTime = Math.abs(now - joinedAt);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays < minJoinDays) {
                    throw new Error(`您加入 Discord 服务器的时间不足 ${minJoinDays} 天，无法注册。`);
                }
            }
        } catch (error) {
            console.error('Discord Guild Verification Error:', error);
            throw error;
        }
    }

    /**
     * 标准化不同提供商的用户信息
     */
    normalizeUserInfo(provider, userData) {
        switch (provider) {
            case 'github':
                return {
                    id: String(userData.id),
                    username: userData.login,
                    displayName: userData.name || userData.login,
                    email: userData.email,
                };
            case 'discord':
                return {
                    id: String(userData.id),
                    username: userData.username,
                    displayName: userData.global_name || userData.username,
                    email: userData.email,
                };
            case 'linuxdo':
                return {
                    id: String(userData.id || userData.user_id),
                    username: userData.username || userData.name,
                    displayName: userData.name || userData.username,
                    email: userData.email,
                };
            default:
                throw new Error(`未知的提供商: ${provider}`);
        }
    }

    /**
     * 标准化用户名（移除 kebabCase，修复数字分割问题）
     */
    normalizeHandle(handle) {
         // 只允许小写字母、数字、减号，其他字符替换为减号
        return String(handle ?? '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    }

    /**
     * 生成随机强密码 (12位)
     */
    getDefaultPassword() {
        // 生成包含大小写字母和数字的随机字符串
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
        const length = 12;
        let password = '';
        const randomBytes = crypto.randomBytes(length);
        
        for (let i = 0; i < length; i++) {
            password += chars[randomBytes[i] % chars.length];
        }
        
        return password;
    }
}

