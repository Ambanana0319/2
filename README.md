# Gugu / Pengu Static Showcase

两个本地工具的私密静态交互展示。

- `gugu/` 复用 Gugu 正式前端，数据层固定为空项目和演示连接。
- `pengu/` 复用 Pengu 正式前端，生成、保存、上传和 API 操作均被静态层拦截。
- 仓库不包含后端、数据库、原著、生成正文、日志、API 配置、密钥或真实用户资料。

根目录仅提供两个项目入口。页面可以由任意静态 HTTP 服务打开；直接打开 HTML 也不会连接本地正式服务。

## 本地检查

```bash
npm run verify
python3 -m http.server 8765
```
