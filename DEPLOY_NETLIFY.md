# Netlify 部署说明

这个项目现在分成两层：

- Netlify：部署 `public/index.html` 静态前端。
- WebSocket 中继：部署 `server.js` 到能常驻 Node 进程的平台，例如 Render、Railway、Fly.io、VPS 或本地服务器。

Netlify 适合静态页面和短生命周期函数；当前联机需要常驻 WebSocket 房间中继，所以不要把 `server.js` 直接当 Netlify Function 使用。

## 1. 部署前端到 Netlify

在 Netlify 项目设置里使用：

```text
Base directory: anchor_maiden_multiplayer_project_v1
Publish directory: public
Build command: 留空
```

本仓库已提供 `netlify.toml`，Netlify 会发布 `public` 目录。

当前前端站点：

```text
https://zesty-speculoos-853237.netlify.app/
```

## 2. 部署 WebSocket 中继

把项目上传到支持常驻 Node 服务的平台，然后运行：

```bash
npm install
npm start
```

服务默认监听：

```text
PORT=8787
```

线上平台一般会自动提供 `PORT` 环境变量，`server.js` 已经支持。

中继服务默认允许这个 Netlify 前端和本地开发来源连接：

```text
https://zesty-speculoos-853237.netlify.app
http://localhost:8787
http://127.0.0.1:8787
```

如果之后换了 Netlify 域名，在线上中继服务里设置环境变量：

```text
ALLOWED_ORIGINS=https://你的-netlify-站点,https://其他允许来源
```

部署成功后，你需要拿到一个 WebSocket 地址：

```text
wss://tanqiu.onrender.com/ws
```

本地测试时则是：

```text
ws://localhost:8787/ws
```

## 3. 在 Netlify 页面连接中继

打开 Netlify 页面后，在主菜单的“中继地址”里填入：

```text
wss://tanqiu.onrender.com/ws
```

然后两个玩家输入同一个房间名：

- 玩家 A 点“联机掌舵手”
- 玩家 B 点“联机航海士”

也可以直接用 URL 参数：

```text
https://zesty-speculoos-853237.netlify.app/?room=test&role=helm&relay=wss%3A%2F%2Ftanqiu.onrender.com%2Fws
https://zesty-speculoos-853237.netlify.app/?room=test&role=navigator&relay=wss%3A%2F%2Ftanqiu.onrender.com%2Fws
```

## 4. 检查命令

本地检查：

```bash
npm run check
```

会检查：

- 游戏脚本语法
- 服务端语法
- 木板/锚点规则
- WebSocket 中继权限、房间状态、快照、卡牌请求
