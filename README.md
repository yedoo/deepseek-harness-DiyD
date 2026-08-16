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
- 标题栏右上角使用静态更新图标；有新版时显示蓝色圆点，检查状态只在对应行显示
- 客户端更新可在应用内下载，支持进度、失败续试与“立即重启”；正常退出也会安装已下载版本
- Harness 可直接在应用内更新：后台 staging 安装，重启后切换、健康检查与失败回滚
- Harness 更新事务写入磁盘；页面重载、退出或切换中断后都能恢复真实状态
- Harness 更新使用用户目录中的独立运行时，不覆盖本地源码目录或会话数据
- 仅允许 Harness 本机源留在应用内，外部网页使用系统浏览器打开
- 退出时只清理客户端自己启动的 Harness 进程

这一版暂不包含皮肤、插件市场、托盘、Harness 源码改写、内置终端和文件树。

## 更新方式

桌面客户端安装后会从本项目的 GitHub Releases 检查新版。用户点击后在应用内下载；下载完成可立即重启，也可在之后正常退出时自动安装。安装程序使用 `latest.yml` 中的 SHA-512 校验下载文件。

官方 Harness 使用独立版本通道：客户端读取当前运行版本，再与 npm 上的 `@deepseek-ai/dsh` 最新版本比较。用户确认后，新版及其依赖先安装到应用数据目录的 `harness-runtime/staging`，当前 Harness 和工作台页面保持运行。校验完成后界面显示“已准备好，重启后生效”。下一次启动时客户端执行原子切换与独立健康检查；失败会恢复旧运行时或原源码安装。

更新阶段、目标版本、时间和失败原因记录在持久化事务文件中。即使客户端在切换前后意外退出，下一次启动也会继续完成或安全回退，更新面板不会依赖一次性的页面事件。源码目录、`DSH_HOME` 与工作区文件都不会被更新器改写。

更新验证会为首次配置迁移保留 120 秒冷启动时间；普通工作台启动仍使用 30 秒上限。若启动检查失败，点击“重试更新”会优先复用已经下载并校验过的运行时，无需重复下载。

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
3. 更新日志、发布通道与签名
4. 插件和皮肤能力
