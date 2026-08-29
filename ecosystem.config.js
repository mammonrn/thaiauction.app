module.exports = {
  apps: [{
    name: "thaiauction",
    script: "node_modules/.bin/next",
    args: "start",
    cwd: "/home/thaiauction/thai-auction",
    exec_mode: "cluster",
    instances: 2,
  }]
};
