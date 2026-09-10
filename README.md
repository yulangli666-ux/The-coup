# 政变疑云

一款基于微信小程序原生框架与微信云开发实现的多人实时联机桌游项目，支持 2 至 6 人同房对局、人机补位、实时同步、文字互动、表情互动、历史战绩与基础语音能力接入。

本项目目前更适合作为个人作品集、课程项目、面试展示项目与小范围内测项目使用。

## 项目概览

- 项目名称：`政变疑云`
- 项目类型：微信小程序多人联机桌游
- 开发方式：独立完成
- 适用场景：课程设计、项目经历展示、微信小程序原生开发练手、云开发实时对战项目实践
- 当前状态：可运行，可用于演示与内测，仍可继续迭代优化
- 作者主页：[yulangli_666](https://github.com/yulangli666-ux/yulangli_666)
- 项目体验说明：由于微信小程序联机、云函数与语音能力依赖微信后台配置，GitHub 仓库默认提供源码与部署说明，不直接提供公网试玩地址

## 项目特色

### 1. 多人实时联机

- 支持创建房间、输入房间码加入房间、快速加入等待中的房间
- 房间状态通过微信云开发数据库实时同步
- 玩家进入、退出、开始游戏、行动结算都能在多端保持一致

### 2. 完整桌游规则流程

- 收入
- 外国援助
- 税收
- 偷窃
- 暗杀
- 政变
- 阻挡
- 质疑
- 大使换牌
- 弃牌与淘汰

### 3. 面向真实游玩的体验功能

- 4 位纯数字房间码
- 房主开局控制
- 房主解散房间
- 玩家中途退出判定死亡
- 历史战绩页
- 表情互动
- 文本聊天
- 人机补位
- 操作音效与结果反馈

### 4. 微信生态适配

- 小程序静默登录
- 用户昵称与头像同步
- 云函数处理关键状态
- 云数据库监听实时刷新页面
- 语音能力预留接入位

## 技术栈

- 前端：微信小程序原生框架
- 后端：微信云开发 CloudBase
- 数据存储：云数据库
- 业务逻辑：云函数 + 本地状态辅助计算
- 实时同步：数据库 `watch`
- 音效：`wx.createInnerAudioContext`
- 交互反馈：震动、日志、弹窗、状态高亮

## 核心功能清单

### 大厅页

- 玩家自动登录
- 自定义昵称
- 随机头像占位样式
- 创建房间
- 加入房间
- 快速加入
- 查看历史战绩
- 查看游戏规则

### 等待房间页

- 显示房间码
- 分享邀请
- 房主设置回合时长
- 房主添加机器人
- 房主踢出玩家
- 查看已加入玩家列表

### 对局页

- 左右座位布局
- 中央日志区
- 回合倒计时
- 当前行动提示
- 质疑 / 阻挡 / 跳过响应
- 手牌查看
- 弃牌选择
- 大使换牌流程
- 表情与文本消息
- 音效控制
- 房主结束对局

### 战绩与规则页

- 查看历史战绩
- 查看规则说明

## 项目亮点

### 1. 使用云函数保证关键对局逻辑收口

创建房间、加入房间、开始游戏、行动执行、质疑结算、阻挡结算、弃牌处理、人机行动等逻辑均通过云函数处理，避免前端直接修改关键状态。

### 2. 采用实时监听实现多人同步

房间状态统一存储在云数据库 `rooms` 集合中，客户端通过 `watch` 监听房间文档变化，从而实现多端近实时同步。

### 3. 规则引擎覆盖复杂交互链路

项目不只是简单回合制展示，而是实现了包含宣称角色、他人质疑、阻挡、阻挡再质疑、亮牌、更换卡牌、弃牌、淘汰与结算在内的一整套联动流程。

### 4. 兼顾测试与游玩体验

为了方便个人测试和低人数开局，项目支持添加机器人玩家；同时提供音效、聊天、表情与历史战绩，提升演示完整度。

## 项目结构

```text
.
├─ cloudfunctions/                # 云函数
│  ├─ addBot/
│  ├─ botAction/
│  ├─ chooseDiscardCard/
│  ├─ chooseExchangeCard/
│  ├─ createRoom/
│  ├─ declareBlock/
│  ├─ declareChallenge/
│  ├─ endTurn/
│  ├─ finishGame/
│  ├─ getRoomState/
│  ├─ getVoIPSignature/
│  ├─ joinRoom/
│  ├─ kickPlayer/
│  ├─ leaveRoom/
│  ├─ passPending/
│  ├─ performAction/
│  ├─ quickJoin/
│  ├─ rematch/
│  ├─ sendEmoji/
│  ├─ startGame/
│  ├─ userLogin/
│  └─ common/
├─ miniprogram/                   # 小程序主程序
│  ├─ assets/
│  │  └─ sounds/                  # 音效资源
│  ├─ components/                 # 组件
│  │  ├─ action-buttons/
│  │  ├─ log-panel/
│  │  └─ player-card/
│  ├─ pages/                      # 页面
│  │  ├─ game/
│  │  ├─ history/
│  │  ├─ index/
│  │  ├─ rules/
│  │  └─ waiting/
│  ├─ utils/
│  │  ├─ gameLogic.js
│  │  └─ sound.js
│  ├─ app.js
│  ├─ app.json
│  └─ app.wxss
├─ docs/                          # GitHub 展示与上传材料
├─ DATABASE.md                    # 数据库设计说明
├─ database.rules.json            # 数据库权限建议
└─ project.config.json            # 小程序项目配置
```

## 数据库设计

详见 [DATABASE.md](./DATABASE.md)。

当前项目主要使用以下集合：

- `users`
- `rooms`
- `roomSecrets`

## 云函数清单

建议上传以下云函数：

- `userLogin`
- `login`
- `createRoom`
- `joinRoom`
- `quickJoin`
- `startGame`
- `getRoomState`
- `performAction`
- `declareChallenge`
- `declareBlock`
- `passPending`
- `endTurn`
- `chooseExchangeCard`
- `chooseDiscardCard`
- `finishGame`
- `leaveRoom`
- `rematch`
- `sendEmoji`
- `kickPlayer`
- `addBot`
- `botAction`
- `getVoIPSignature`

说明：

- `common` 目录为公共逻辑，不单独部署
- 每个云函数需在微信开发者工具中单独“上传并部署：云端安装依赖”

## 本地运行方式

### 1. 环境准备

- 微信开发者工具
- 已开通云开发环境
- 已配置自己的小程序 `AppID`

### 2. 导入项目

将本仓库作为小程序项目导入，确认以下配置：

- `miniprogramRoot` 指向 `miniprogram/`
- `cloudfunctionRoot` 指向 `cloudfunctions/`

### 3. 配置云环境

你需要在 `miniprogram/app.js` 中确认云环境 ID 与当前环境一致。

环境 ID：`待自行确认 / 替换`

### 4. 创建数据库集合

请在云开发控制台中创建：

- `users`
- `rooms`
- `roomSecrets`

数据库权限规则可参考：

- [database.rules.json](./database.rules.json)

### 5. 上传云函数

依次上传 README 中列出的云函数，完成后再进行联机测试。

## 截图与演示

目前仓库未附带最终版项目截图，你可以按下列命名补充到 `docs/screenshots/` 目录：

- `home.png`
- `waiting-room.png`
- `gameplay-main.png`
- `challenge-phase.png`
- `exchange-phase.png`
- `history-page.png`
- `rules-page.png`

详细拍摄建议见：

- [docs/SCREENSHOT_TODO.md](./docs/SCREENSHOT_TODO.md)
- [docs/DEMO_SCRIPT.md](./docs/DEMO_SCRIPT.md)

## 已知说明

### 1. 语音功能

仓库中已预留多人语音接入位，但语音能力是否可直接使用，取决于：

- 小程序后台是否已开通对应能力
- 微信官方接口是否已正确配置签名
- 真机设备是否已授予麦克风权限

因此该部分更适合作为“已设计接入能力”或“可继续完善模块”来展示。

### 2. GitHub 仓库不建议提交的内容

- `project.private.config.json`
- 本地缓存文件
- 开发者工具临时文件
- 个人测试截图中可能包含隐私信息的内容

### 3. 项目适合的展示方式

这个项目非常适合用于：

- 校招简历项目经历
- 面试现场讲解
- GitHub 作品集展示
- 微信小程序原生开发能力证明

## GitHub 展示建议

建议仓库设置：

- 仓库名称：`coup-wechat-miniprogram` 或 `zhengbianyiyun-wechat-miniapp`
- 仓库简介：`基于微信小程序原生框架与微信云开发实现的多人实时联机桌游项目`
- Topics：`wechat-miniprogram`, `cloudbase`, `multiplayer-game`, `miniapp`, `realtime`, `game-logic`, `javascript`

更详细的上传文案与仓库资料，见：

- [docs/PROJECT_META.md](./docs/PROJECT_META.md)
- [docs/GITHUB_UPLOAD_GUIDE.md](./docs/GITHUB_UPLOAD_GUIDE.md)

## 后续可继续优化的方向

- 真正可用的多人语音房间
- 更完善的人机策略
- 更精细的动画反馈
- 更完整的结算战报
- 更成熟的 UI 视觉统一
- 多机型适配与更细致的边界测试

## 作者

李玉郎

- GitHub 主页：[https://github.com/yulangli666-ux/yulangli_666](https://github.com/yulangli666-ux/yulangli_666)
- 邮箱：`2090063241@qq.com`
`
