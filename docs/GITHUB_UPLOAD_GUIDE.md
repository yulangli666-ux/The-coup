# GitHub 上传指南

这份文档用于帮助你把《政变疑云》整理成一个适合公开展示的 GitHub 项目。

## 一、推荐仓库信息

- 仓库名称：`coup-wechat-miniprogram`
- 备用名称：`zhengbianyiyun-wechat-miniapp`
- 仓库简介：`基于微信小程序原生框架与微信云开发实现的多人实时联机桌游项目`
- 仓库可见性：`Public`

## 二、建议上传的内容

### 必须上传

- `miniprogram/`
- `cloudfunctions/`
- `README.md`
- `DATABASE.md`
- `database.rules.json`
- `project.config.json`
- `docs/`
- `.gitignore`

### 建议不要上传

- `project.private.config.json`
- 本地调试缓存
- 带个人隐私的截图
- 含个人测试账号信息的文档

## 三、GitHub 页面建议填写

### About 简介

可直接填写：

`基于微信小程序原生框架与微信云开发实现的多人实时联机桌游项目，支持房间对战、实时同步、人机补位、聊天互动与历史战绩。`

### Website

如果没有线上公开地址，可以先留空。

可选填写：

- 项目演示视频链接：`待补充`
- 飞书文档 / 语雀文档：`待补充`

### Topics

建议添加这些标签：

- `wechat-miniprogram`
- `cloudbase`
- `javascript`
- `miniapp`
- `multiplayer-game`
- `realtime`
- `game-logic`
- `cloud-function`

## 四、上传前最后检查

- 确认 `README.md` 中没有测试账号、手机号、OpenID、云环境密钥等敏感信息
- 确认 `project.private.config.json` 不会被提交
- 确认截图中没有个人聊天记录、设备号或隐私信息
- 确认云函数目录结构完整
- 确认 `docs/` 中的占位内容已按需补齐

## 五、推荐的首版提交说明

### 首次提交标题

`feat: 初始化政变疑云微信小程序联机版项目`

### 首次提交描述

- 完成微信小程序多人联机桌游基础框架
- 接入微信云开发数据库与云函数
- 支持房间创建、加入、快速加入与实时对局同步
- 实现基础规则流程、聊天互动、人机补位与历史战绩

## 六、仓库补充材料建议

你后续可以继续补：

- 项目首页截图
- 对局截图
- 大使换牌流程截图
- 历史战绩页截图
- 录屏演示视频
- 项目架构图
- 时序图

## 七、公开展示时的建议说法

如果有人看到仓库后问“为什么没有直接在线试玩地址”，你可以这样写：

`该项目依赖微信小程序环境、云开发配置与多端联机测试，因此仓库主要提供完整源码、部署说明与演示材料。`
