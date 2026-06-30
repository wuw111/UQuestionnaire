# 📝 UQuestionnaire | 强大的服务器调查问卷系统

![Version](https://img.shields.io/badge/版本-v1.0.0-blue) ![Author](https://img.shields.io/badge/作者-wuw111-orange) ![License](https://img.shields.io/badge/开源协议-AGPL--3.0-green) ![Platform](https://img.shields.io/badge/平台-LiteLoaderBDS%20%7C%20LeviLamina-lightgrey)

**UQuestionnaire** 是一款为 Minecraft 基岩版 (BDS) 打造的现代化、高自定义的调查问卷插件。通过本插件，服主可以轻松收集玩家的游戏反馈、活动建议，并通过丰厚的奖励机制鼓励玩家参与填写。

本插件**永久免费且开源**。如果您是付费获取的本插件，请立即退款并举报商家！
🔗 **官方原址/问题反馈**：[GitHub - wuw111/UQuestionnaire](https://github.com/wuw111/UQuestionnaire) | **反馈QQ群**：1097933637

---

## ✨ 核心特性

- 🔀 **动态逻辑分支**：支持“条件触发”问题（例如：玩家选了“不满意”，才弹出“请说明原因”的输入框）。
- 💾 **进度防丢机制**：玩家中途退出、断线或关掉表单，作答进度会自动保存，下次可无缝继续。
- 🎁 **多元化奖励系统**：支持发放经济（LLMoney/计分板）、实体物品（通过SNBT解析）、以及执行任意控制台指令（支持 `%name%` 变量）。
- 📊 **完善的数据分析**：内置问卷漏斗统计（推送人数 vs 完成人数），并支持一键导出 **CSV 表格**，方便使用 Excel 分析。
- 🔔 **智能弹窗推送**：玩家进服时，系统可按配置的概率和延迟时间，自动向符合条件的玩家推送问卷。
- 🛡️ **精准的目标群体**：可以设置计分板条件（如：等级达到30、金币大于1000等），只有符合条件的玩家才能看到特定问卷。
- 📝 **四种题型支持**：单选题、多选题（可限制最多选几项）、文本填空题、数字评分题（可限制打分区间）。

---

## 📥 安装与依赖

1. 确保您的服务器已安装 **LiteLoaderBDS** 或 **LeviLamina** 运行环境。
2. 下载本插件的 `.js` 文件，将其放入服务器的 `plugins` 文件夹中。
3. 重启服务器，插件将自动生成 `plugins/UQuestionnaire/` 文件夹及默认配置文件。

---

## 🎮 指令与权限

| 指令 | 描述 | 权限 |
| :--- | :--- | :--- |
| `/wj` | 打开问卷中心主菜单 | 所有玩家 |
| `/wj admin` | 打开后台管理主菜单（可视化UI） | 仅 OP |
| `/wj export [问卷ID]` | 快捷导出指定问卷的数据至 CSV | 仅 OP |
| `/wj cleanup` | 清理无用的/过期的问卷作答缓存数据 | 仅 OP |

---

## ⚙️ 配置文件指南

插件的数据保存在 `plugins/UQuestionnaire/` 目录下。

### 1. 基础配置 (`config.json`)
控制插件的全局推送行为和经济对接方式：
```json
{
    "pushProbability": 0.5,      // 进服弹窗推送概率 (0.5 = 50%概率)
    "pushDelayMs": 10000,        // 进服后延迟多少毫秒弹出推送 (10000 = 10秒)
    "economy": {
        "type": "scoreboard",    // 经济类型：支持 "scoreboard"(计分板) 或 "llmoney"(LL经济核心)
        "sbName": "money"        // 如果使用计分板，这里填写计分板项的名称
    }
}
```

### 2. 问卷配置 (`questions.json`)
这是插件的核心，用于编写您的问卷。插件首次运行时会生成一个示例问卷。
以下是问卷结构的详细解析：

```json
{
  "list": {
    "sample_q1": {  // 问卷的唯一ID
      "title": "服务器游戏体验调查问卷",
      "startTime": "2024-01-01 00:00:00", // 问卷开始时间
      "endTime": "2099-12-31 23:59:59",   // 问卷结束时间
      "conditions": {
        "scoreboards": { "money": 1 }     // 准入条件：这里要求 money 计分板至少为 1
      },
      "rewards": {
        "money": 500,                     // 奖励金钱
        "items": [],                      // 奖励物品 (填入SNBT字符串)
        "cmds": [                         // 奖励指令 (%name% 会被替换为玩家名)
          "tellraw %name% {\"rawtext\":[{\"text\":\"感谢参与体验问卷！\"}]}"
        ]
      },
      "allowMultiple": false,             // 是否允许玩家重复提交（重复提交不会再次发放奖励）
      "questions": [                      // 题目列表
        {
          "id": "q1",
          "type": "single",               // 题型: single(单选) / multi(多选) / text(填空) / rating(打分)
          "title": "您对服务器的整体体验满意吗？",
          "options": ["非常满意", "满意", "一般", "不满意", "垃圾"],
          "required": true                // 是否必答
        },
        {
          "id": "q2",
          "type": "text",
          "title": "请说明您觉得体验差的原因：",
          "required": true,
          "dependsOn": {                  // 🌟逻辑分支：只有当上一题(q1)选了包含"不满意"或"垃圾"时，此题才出现
            "qId": "q1",
            "contains": ["不满意", "垃圾"]
          }
        },
        {
          "id": "q4",
          "type": "rating",
          "title": "如果满分为10分，您愿意给服务器打几分？",
          "min": 1,                       // 评分题专有：最小允许数字
          "max": 10,                      // 评分题专有：最大允许数字
          "required": true
        }
      ]
    }
  }
}
```

---

## 👨‍💻 OP 后台管理系统

管理员在游戏内输入 `/wj admin` 即可唤出图形化管理菜单：

1. **刷新重载配置信息**：在后台修改了 `questions.json` 后，点击此项即可实时生效，无需重启服务器。
2. **调取并导出答卷数据汇总**：选择一份问卷，系统会将其所有玩家的作答记录导出为 `CSV` 格式文件。
   * 📁 导出路径：`plugins/UQuestionnaire/export/Report_问卷ID_时间戳.csv`
3. **清理无效的问卷作答记录**：清理玩家填了一半放弃的进度缓存，或已经被您从配置文件中删除的废弃问卷数据，释放存储空间。
4. **预览问卷基础统计信息**：在游戏内直观查看：该问卷推送给了多少人、有多少人完成了填写、完成转化率是多少。

---

## ⚠️ 注意事项

* **JSON 语法规范**：修改 `questions.json` 时，请务必保证 JSON 格式严格正确（不要漏逗号或多逗号）。如果配置写错，插件会自动检测错误并备份恢复默认配置。
* **物品奖励发放**：`rewards.items` 采用的是底层的 SNBT 数据。如果您觉得获取 SNBT 太麻烦，强烈建议直接在 `rewards.cmds` 中使用 `/give %name% 物品名 数量` 来发放物品奖励。
* **KVDatabase 提醒**：答卷数据保存在 `answers_db` 文件夹中。如果您要迁移服务器数据，请务必将整个 `UQuestionnaire` 文件夹一同打包，避免玩家答卷数据丢失。