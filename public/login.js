function setStatus(message = '', isError = false) {
    const statusElement = document.getElementById('status');
    if (!statusElement) return;

    statusElement.textContent = message;
    const hasText = Boolean(message);
    statusElement.classList.toggle('status-error', hasText && isError);
    statusElement.classList.toggle('status-success', hasText && !isError);
}

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('login-form');
    const oauthProvidersElement = document.getElementById('oauth-providers');
    const oauthButtonsElement = document.getElementById('oauth-buttons');

    // 加载 OAuth 提供商
    loadOAuthProviders();

    // 检查手动登录配置
    checkLoginConfig();

    if (!form) return;

    // 检查手动登录配置
    async function checkLoginConfig() {
        try {
            const response = await fetch('/api/config');
            if (response.ok) {
                const config = await response.json();
                if (config.enableManualLogin === false) {
                    // 隐藏登录表单
                    if (form) form.style.display = 'none';
                    // 隐藏分割线
                    const divider = document.querySelector('.divider');
                    if (divider) divider.style.display = 'none';
                    // 隐藏标题或修改提示
                    const header = document.querySelector('.card-header h2');
                    if (header) header.textContent = '登录';
                    
                    // 隐藏底部的注册链接
                    const note = document.querySelector('.note');
                    if (note) note.style.display = 'none';
                    
                    // 如果只剩下 OAuth，调整样式
                    if (oauthProvidersElement) {
                        oauthProvidersElement.style.marginTop = '0';
                        oauthProvidersElement.style.paddingTop = '0';
                        oauthProvidersElement.style.borderTop = 'none';
                    }
                }
            }
        } catch (e) {
            console.error('Failed to load config', e);
        }
    }

    // 加载 OAuth 提供商
    async function loadOAuthProviders() {
        try {
            const response = await fetch('/oauth/providers', {
                headers: { accept: 'application/json' },
            });
            
            if (!response.ok) {
                return;
            }

            const data = await response.json();
            const providers = data.providers || [];

            if (providers.length === 0) {
                return;
            }

            // 显示 OAuth 区域
            if (oauthProvidersElement) {
                oauthProvidersElement.style.display = 'block';
            }

            // 创建 OAuth 按钮
            if (oauthButtonsElement) {
                oauthButtonsElement.innerHTML = '';
                for (const provider of providers) {
                    const button = document.createElement('a');
                    button.className = `oauth-button ${provider.id}`;
                    button.href = `/oauth/auth/${provider.id}`;
                    button.textContent = `使用 ${provider.name} 登录`;
                    oauthButtonsElement.appendChild(button);
                }
            }
        } catch (error) {
            console.debug('无法加载 OAuth 提供商:', error);
        }
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        setStatus('');

        const formData = new FormData(form);
        const handle = formData.get('handle');
        const password = formData.get('password');

        if (!handle || !password) {
            setStatus('请输入用户标识和密码。', true);
            return;
        }

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({ handle, password }),
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                setStatus(data.message || '登录失败', true);
                return;
            }

            setStatus('登录成功，正在跳转...', false);
            setTimeout(() => {
                window.location.href = data.redirectUrl || '/select-server';
            }, 1000);

        } catch (error) {
            setStatus('发生系统错误，请稍后重试。', true);
            console.error('Login error:', error);
        }
    });
});
