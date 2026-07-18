# AI 妆容推荐 · 双引擎面容诊断

一个基于 AI 人脸识别的个性化化妆推荐应用。上传一张正面自拍，自动分析你的脸型、眉毛、眼睛、鼻子、嘴唇五大部位特征，并为每个部位推荐最匹配的化妆教学视频。

## ✨ 功能特性

- **双引擎面容分析**
  - **MediaPipe Face Mesh**：浏览器本地运行，468 个面部关键点 + 3D 深度数据，精准测量脸长宽比、下颌角度、鼻梁立体度等
  - **DeepSeek AI 增强**：把 468 点测量数据发送给 DeepSeek，生成个性化化妆建议（需自备 API Key）
- **五部位精细分类**：每个部位支持 5~9 种细分类型（如方圆脸、鹅蛋偏心形脸等过渡类型），不同脸型给出不同推荐
- **B 站实时搜索**：直接搜索 Bilibili 上最新发布的化妆教程，带 WBI 签名绕过反爬，视频封面正常显示
- **组合推荐**：根据多部位特征组合（如"方圆脸+肿眼泡"）给出针对性更强的组合化妆方案
- **隐私优先**：照片在浏览器本地分析，不上传服务器；AI 增强分析需用户主动开启

## 🚀 快速开始

### 环境要求
- [Node.js](https://nodejs.org/) 14 或更高版本

### 运行步骤

```bash
# 1. 进入项目目录
cd ai-makeup-advisor

# 2. 启动本地服务器
node server.js

# 3. 打开浏览器访问
#    http://localhost:8090
```

打开后：
1. 上传一张清晰的正面自拍
2. 等待 MediaPipe 完成本地分析（几秒）
3. 如需 AI 增强，在顶部填入 DeepSeek API Key 并点击"启动 AI 增强分析"
4. 查看五部位的化妆推荐视频，点击卡片直接观看

## 🔑 关于 API Key

- DeepSeek API Key 由用户自行在 [DeepSeek 平台](https://platform.deepseek.com/)申请
- Key 只保存在浏览器 localStorage，不会上传到任何服务器，也不会随代码一起提交到 GitHub
- 代码仓库中**不包含**任何硬编码的 API Key

## 📁 项目结构

```
ai-makeup-advisor/
├── index.html      # 单文件应用（前端 + MediaPipe 分析逻辑）
├── server.js       # Node.js 代理服务器（静态文件 + B站搜索/图片代理）
├── .gitignore
└── README.md
```

## 🛠️ 技术栈

- **前端**：原生 HTML/CSS/JS（单文件，无构建步骤）
- **人脸识别**：MediaPipe Face Mesh（@mediapipe/face_mesh，CDN 加载）
- **AI 分析**：DeepSeek V4 Flash（文本模型，基于 468 点测量数据生成建议）
- **B 站搜索**：WBI 签名 + Node.js 代理服务器
- **回退方案**：MediaPipe 加载失败时自动回退到 face-api.js 68 点模式

## ⚠️ 说明

- 本应用面向正面自拍，侧面照会影响骨骼判断准确度
- AI 增强分析每次约消耗 0.01 元（DeepSeek Flash 定价）
- B 站搜索结果依赖网络环境，部分视频可能因地区限制无法播放

## 📄 License

MIT
