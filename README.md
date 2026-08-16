# DeepSeek Harness Desktop

一个简洁、无边框的 DeepSeek Harness 桌面宿主。它保留官方 Harness 的界面和数据格式，只负责窗口、启动、进程和系统集成。

> 本项目是非官方桌面客户端，与 DeepSeek 官方无隶属关系。DeepSeek 名称与标识归其权利人所有。

## 第一版包含

- 36px 无边框桌面标题栏
- 最小化、最大化、还原和关闭
- 单实例运行
- 自动连接已运行的 `127.0.0.1:3080`
- 未发现服务时自动分配端口并启动 `dsh web`
- 复用 Electron 内置 Node，运行客户端无需单独安装 Node.js
- 自动沿用 Harness 安装目录旁的 `data` 数据目录
- 首次运行可选择本机 DeepSeek Harness 目录
- Windows 工作区选择器会立即显示在桌面窗口前方
- 启动状态、失败重试和日志入口
- 独立检查桌面客户端与官方 Harness 的新版本
- 标题栏右上角常驻更新图标；有新版时显示蓝色圆点，点击展开双通道更新面板
- 客户端更新可在应用内下载，并由用户确认“重启并更新”
- Harness 更新只提醒并打开官方 npm 页面，不覆盖本地源码目录
- 仅允许 Harness 本机源留在应用内，外部网页使用系统浏览器打开
- 退出时只清理客户端自己启动的 Harness 进程

这一版暂不包含皮肤、插件市场、托盘、Harness 源码自动更新、内置终端和文件树。

## 更新方式

桌面客户端安装后会从本项目的 GitHub Releases 检查新版。发现更新时会先询问，下载完成后仍需点击“重启并更新”；不会在退出应用时静默安装。安装程序使用 `latest.yml` 中的 SHA-512 校验下载文件。

官方 Harness 使用独立版本通道：客户端读取本地 `apps/cli/package.json`，再与 npm 上的 `@deepseek-ai/dsh` 最新版本比较。由于当前运行的是用户选择的源码目录，第一版只提醒和跳转官方页面，避免自动覆盖本地修改。

两个通道均在启动约 3 秒后检查，之后每 6 小时检查一次。发现新版时只显示状态圆点，不主动弹窗；网络失败不会影响工作台启动。安装版连接到已经运行的 `127.0.0.1:3080` 时，会从该进程识别并保存实际 Harness 目录，因此版本检查不再依赖首次目录选择。

## 本地开发

建议目录结构：

```text
DeepSeek/
├─ deepseek-harness/          # 官方仓库
├─ deepseek-harness-desktop/  # 本项目
└─ data/                      # 会话与配置
```

安装依赖并启动：

```powershell
npm install
npm run dev
```

如果官方仓库不在相邻目录，首次启动时选择仓库目录，或者设置：

```powershell
$env:DSH_INSTALL_ROOT = "D:\DeepSeek\deepseek-harness"
```

## 验证与构建

```powershell
npm test
npm run typecheck
npm run build
npm run dist:win
```

Windows 安装包输出到 `release/`。

## 可选环境变量

| 变量 | 用途 |
| --- | --- |
| `DSH_INSTALL_ROOT` | 指定官方 Harness 仓库目录 |
| `DSH_HOME` | 指定 Harness 数据目录 |
| `DSH_SERVER_URL` | 连接指定的本机 Harness 地址 |
| `DSH_NODE_EXECUTABLE` | 使用指定 Node.js；默认复用 Electron 内置 Node |

## 架构

桌面窗口只调用 `HarnessService.start()` 与 `HarnessService.stop()`。路径发现、已有服务探测、随机端口、进程启动、健康检查、日志和清理全部封装在该模块内部。

Renderer 不启用 Node.js，Preload 只暴露窗口控制、重试、目录选择、更新操作和日志入口。应用内导航锁定到当前 Harness 的精确本机 Origin。

## 后续方向

1. 完善应用图标、签名和安装体验
2. 系统托盘与任务完成通知
3. Harness 安全升级与版本回滚
4. 插件和皮肤能力
