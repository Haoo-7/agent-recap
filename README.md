# agent-recap

<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="agent-recap：让每个 AI coding agent 的回复结尾都带上一句 recap 交接和一行 Next 下一步；右侧是真实的回复结尾标本与安装命令。">
</p>

<p align="center">
  <img src="./assets/readme/how-it-works.svg" width="100%" alt="agent-recap 工作方式：install 检测本机 agent 并逐个写入，status 查看每台的覆盖状态，remove 撤除全部受管内容">
</p>

## 有什么用

给这台机器上所有 AI coding agent 装上同一条收尾规则：每条有实质内容的回复结尾，附一行 `🏁 recap:` 说明这轮在做什么、为什么，再加一行 `Next:` 说明当前状态、阻塞或下一步。

不装这个 Skill 时：每个 agent 的回复风格各不相同，长篇回复看完不知道干了什么、下一步该干什么；想统一就得逐台查它的全局指令文件写在哪、格式是否兼容，漏一个就是一个例外。装好之后：一条命令检测本机装了哪些 agent，按各自的原生机制写入，重复执行是原地更新不会叠加，一条命令全体撤除。

## 安装

1. 把仓库地址告诉 Agent："请帮我安装这个 Skill。"

   ```
   https://github.com/Haoo-7/agent-recap
   ```

2. 或直接用命令安装：

   ```bash
   npx skills add Haoo-7/agent-recap
   ```

两种方式都需要 `npx`（仅安装时需要）。Skill 本身运行只依赖 Node.js，不联网、无第三方包。

## 配置

首次使用无需任何配置。默认 `🏁 recap:` 前缀、两句话上限。想改格式：编辑 `scripts/recap.mjs` 顶部的 `CONFIG`（`prefix`、`nextLabel`、`maxSentences`），重跑一次 install，所有 agent 原地更新。

## 使用

用自然语言触发，例如：

- "以后我每个 agent 回复结尾都带 recap 小结"
- "recap 前缀换成 🎯，允许三句话"
- "把 recap 全撤掉"

常用命令（在 Skill 目录内执行）：

```bash
node scripts/recap.mjs install    # 检测已装 agent 并逐个写入
node scripts/recap.mjs status     # 查看每个 agent 的覆盖状态
node scripts/recap.mjs remove     # 撤除全部受管内容
```

所有子命令支持 `--dry-run`，只打印计划不写文件。改动对所有 agent 生效需要各自重启。

## 兼容性与依赖

- Node.js（任意较新版本，只用标准库），无网络请求，无第三方依赖。
- macOS 已实测；Windows / Linux 未实测（脚本不依赖任何平台命令，预期可用）。
- 每个适配器的验证状态、适配的 agent 版本和漂移风险见 `references/adapters.md`。未验证的适配器是尽力而为：如 Gemini CLI 一项从未在真实安装上确认过。

## 数据与适用边界

- 只在本机用户目录内写文件，不读取对话内容，不接触任何密钥，不联网。
- 只会替换自己管理的标记区块；同名外部文件先备份再替换，不删除用户内容。
- 不适用：对当前对话做一次性总结、修改其他回复行为、手工修改单个 agent 的配置。

## 输出

每个检测到的 agent 得到一个带 `<!-- recap:begin/end -->` 标记的规则区块；OpenCode 额外生成一个注入系统提示的插件文件；从未装过指令文件的 agent 会新建对应文件。卸载只删这些内容。

## 测试

```bash
node --test tests/recap.test.mjs    # 生命周期回归：安装、幂等、改配置、卸载
node scripts/recap.mjs status       # 查看本机覆盖情况
```
