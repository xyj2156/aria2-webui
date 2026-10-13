# 语言包出处说明 / Locale provenance

本目录的 11 个 `.yaml` 是界面文案的唯一来源（键集以 `zh-CN.yaml` 为准，由 `pnpm build` 前置的 `scripts/i18n-audit.mjs` 盯一致性）。**文案键结构与本项目的 UI 均由本项目设计**；但一部分字符串复用了 [AriaNg](https://github.com/mayswind/AriaNg)（Copyright (c) 2016-2026 MaysWind，MIT 许可）社区多年积累的人工译文，因此每个非兜底语言文件都是**修改过的派生物**，不是拷贝。许可证全文见仓库 `licenses/AriaNg-MIT.txt`，随包声明见 `NOTICE` 与 `THIRD-PARTY-NOTICES.txt` 的 A 节。

## 复用与自研的分界

两条复用通道，都只取「人工译文」，取不到的一律由本项目自译：

1. `options.*`（aria2 选项名与说明，280 键）——按点号路径与 AriaNg 各语言字典（经 `project` 的 `i18n/locales/*.json`）逐键对齐后直接复用；这些是 aria2 官方选项文档的翻译，与本项目 UI 无关，重写没有收益。
2. 其余界面串——仅当本项目的英文原文与 AriaNg 的键名（就是英文源串）**逐字相同**时复用该语言的译文；语义不同或措辞不同即不匹配，不会串味。

## 各文件构成（516 键/包）

| 语言 | 复用人工译文 | 其中 `options.*` | 其中界面串 | 本项目自译 | 语境修正 | 未覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| `zh-CN`（兜底） | 280（`options.*`） | 280 | — | 236 | — | 0 |
| `en-US` | 280（`options.*`） | 280 | — | 236 | — | 0 |
| `cs-CZ` | 399 | 280 | 119 | 114 | 2 | 0 |
| `de-DE` | 392 | 280 | 112 | 121 | 2 | 0 |
| `es-ES` | 393 | 280 | 113 | 116 | 6 | 0 |
| `fr-FR` | 389 | 279 | 110 | 118 | 8 | 0 |
| `it-IT` | 356 | 278 | 78 | 154 | 5 | 0 |
| `ja-JP` | 400 | 280 | 120 | 113 | 2 | 0 |
| `pl-PL` | 396 | 280 | 116 | 116 | 3 | 0 |
| `ru-RU` | 395 | 280 | 115 | 113 | 7 | 0 |
| `zh-TW` | 384 | 280 | 104 | 114 | 17 | 0 |

`zh-CN` / `en-US` 的 280 个 `options.*` 同样源自 AriaNg 字典（简体与英文两侧），本项目只有兜底语言静态导入，其余按需 `import()`。

## 语境修正是什么

按英文原文逐字匹配会带来两类错，已逐条改掉了，共 52 处：

- **上下文错位**：AriaNg 的同一个英文键在它自己的界面里指别的对象。典型如意大利语 `task.tab.peers` 复用值是 `Stato della connessione`（连接状态），放进标签页就成了长句；俄语/波兰语的分片标签同理。
- **术语不统一**：AriaNg 繁体中文把 task 译作「工作」，而本项目一律用「任務」；`piece`、`seeders` 等概念在部分语言里同时存在直译与意译两套。同语言内的术语族已强制对齐（`piece` / `seeder` / `peer` 三族抽查通过）。
- 另修掉 1 处上游损坏值：`es-ES` 的 `webui.copy` 在 AriaNg 字典里是 `CoCopiarpy`。

仍有 1–5 条冷门 `options.*` 保持英文原样（AriaNg 上游亦未译），属预期，不是漏项。

## 想改进译文

改完只要 `pnpm build` 过（审计会查键集、`{占位符}`、代码引用与 Naive UI 入口）。母语者复核欢迎，尤其是 `it-IT`（AriaNg 意大利语字典本身缺口最大，本项目自译占比最高）。

English summary: the message-key structure is this project's own; 3,504 of the 4,644 non-fallback strings reuse human translations maintained by the AriaNg project (MIT, Copyright (c) 2016-2026 MaysWind), 1,079 were authored here, and 52 reused values were corrected for scope or terminology. Every option label is reused by exact key match, and every UI string only when the English source text is byte-identical. `NOTICE` and `licenses/AriaNg-MIT.txt` carry the license text that travels with each release archive.
