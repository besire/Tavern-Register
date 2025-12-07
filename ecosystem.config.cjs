module.exports = {
  apps : [{
    name   : "tavern-register",
    script : "./src/server.js",
    env: {
      NODE_ENV: "production",
      PORT: 3070
    }
  }]
}
