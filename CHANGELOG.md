# Changelog

## v1 联机布场原型

- 在原 `anchor_maiden_oceanic_systems_v4.html` 基础上加入航海士布场系统。
- 新增航材资源、布场冷却、同屏航障上限。
- 新增四类漂流封板：
  - 临时护航 / 脆裂护板
  - 导流斜架 / 错航导板
  - 破障爆板 / 诱爆残板
  - 航道调度 / 封港警报
- 新增压裂点：
  - 局部命中计数
  - 龟裂 / 临界 / 击碎状态
  - 击碎给分、弹飞、免费锚链窗口
- 新增重锚与木板破坏联动。
- 新增联机：
  - Node WebSocket relay
  - 房间参数 room
  - 角色参数 role=helm / navigator
  - navigator 发送布场请求
  - helm 执行权威模拟并广播快照
