# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 提供该代码仓库的开发指南。

## 项目概述

CloudFlare-ImgBed 是一个多租户图床/文件托管解决方案，支持 Cloudflare Pages（无服务器）和 Docker 两种部署方式，提供文件上传、管理和分发功能，支持多种存储后端。

## 开发命令

```bash
# 本地开发（Cloudflare Pages 模式）
npm start
# 实际执行：npx wrangler pages dev ./ --kv "img_url" --r2 "img_r2" --ip 0.0.0.0 --port 8080 --persist-to ./data

# Docker 模式开发
npm run start:docker
# 实际执行：node --import ./server/register.mjs server/index.js

# 运行测试
npm test
# 实际执行：mocha

# CI 测试（启动服务器并运行测试）
npm run ci-test
```

## 架构设计

### 双运行时架构

代码库支持两种运行模式，业务逻辑共享：

1. **Cloudflare Pages 模式** (`npm start`)
   - 使用 Cloudflare Pages Functions（代码在 `functions/` 目录）
   - Cloudflare KV 存储元数据 (`env.img_url`)
   - Cloudflare D1 关系型数据库 (`env.img_d1`)
   - Cloudflare R2 对象存储 (`env.img_r2`)

2. **Docker 模式** (`npm run start:docker`)
   - 基于 Hono 框架的 Node.js 服务器 ([`server/index.js`](server/index.js))
   - 使用 `better-sqlite3` 的 SQLite ([`server/sqliteD1.js`](server/sqliteD1.js))，模拟 D1 接口
   - 本地文件系统 ([`server/r2Storage.js`](server/r2Storage.js))，模拟 R2 接口
   - 自动从 `functions/` 目录导入函数

### 目录结构

```
functions/              # Cloudflare Pages Functions（两种模式都运行）
├── api/               # REST API 接口
│   ├── manage/        # 管理操作（需要认证）
│   ├── upload/        # 文件上传处理器
│   └── ...
├── upload/            # 上传入口点
├── file/              # 文件获取
├── dav/               # WebDAV 协议支持
├── random/            # 随机图片接口
└── utils/             # 共享工具函数

server/                # 仅 Docker 模式
├── index.js           # Hono 服务器 + 函数加载器
├── sqliteD1.js        # 兼容 D1 的 SQLite 适配器
└── r2Storage.js       # 兼容 R2 的文件系统适配器

database/              # SQL 迁移和初始化脚本
```

### 数据库抽象层

所有数据库访问都通过 [`functions/utils/databaseAdapter.js`](functions/utils/databaseAdapter.js)：

```javascript
import { getDatabase } from '../utils/databaseAdapter.js';

const db = getDatabase(env);
await db.put(key, value, { metadata });
const { metadata } = await db.getWithMetadata(key);
```

适配器自动检测当前运行在 Cloudflare (KV/D1) 还是 Docker (SQLite) 环境。

### 存储后端

上传处理器在 [`functions/upload/index.js`](functions/upload/index.js) 中支持多种渠道：
- **TelegramNew**: 通过 Bot API 上传到 Telegram 频道
- **CloudflareR2**: Cloudflare R2 对象存储
- **S3**: AWS S3 或兼容服务（支持自定义端点）
- **Discord**: Discord 频道文件上传
- **HuggingFace**: HuggingFace 数据集上传
- **External**: 存储外部 URL 引用

### 中间件链

函数使用 Cloudflare Pages Functions 中间件模式：

```javascript
// _middleware.js
export const onRequest = [authMiddleware, errorHandler];

// endpoint.js
export async function onRequest(context) {
    const { request, env, params, waitUntil, data } = context;
    // ... 处理器逻辑
}
```

特殊路径参数：
- `[[path]].js` - 通配符路由（如 `/file/[[path]].js` 处理 `/file/any/path`）

### 配置系统

配置存储在 KV/D1 中，通过 [`functions/utils/sysConfig.js`](functions/utils/sysConfig.js) 管理：

- `fetchUploadConfig()` - 上传渠道设置
- `fetchSecurityConfig()` - 安全/审计设置
- `fetchOthersConfig()` - 遥测和其他设置

## 关键实现要点

1. **文件上传**: 大文件采用分片上传（见 [`functions/upload/chunkUpload.js`](functions/upload/chunkUpload.js)），解决 Telegram 20MB 限制问题

2. **图片审核**: 可选使用 Cloudflare API 进行内容审核，结果存储在 metadata.Label 中

3. **认证**: 双认证系统，同时支持密码和 API Token（见 [`functions/utils/dualAuth.js`](functions/utils/dualAuth.js)）

4. **Docker 兼容性**: 服务器拦截对自己的 `fetch()` 调用以处理端口映射问题 ([`server/index.js`](server/index.js) 第 30-68 行)

5. **数据库迁移**: Docker 模式启动时自动运行 `database/migrations/` 目录下的 SQL 文件
