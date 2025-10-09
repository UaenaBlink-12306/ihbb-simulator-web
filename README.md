# IHBB 模拟器网页版

前端能够加载 `questions.json`（由 `build_db.py` 生成），并按 Region/时代/来源 进行筛选。后端 `server.py` 提供本地判分接口，并支持通过 OpenRouter 使用 DeepSeek 模型判分。此说明帮助你对齐“分类”的数据结构并开启 DeepSeek 分类/判分。

## 数据结构（与 build_db.py 对齐）

- 顶层（单套题）：
  - `id`: 字符串
  - `name`: 名称
  - `items`: 数组
- 每个 item：
  - `id`: 字符串
  - `question`: 题干
  - `answer`: 标答（已清洗；别名从括注中抽取）
  - `aliases`: 接受的同义/别名
  - `meta`:
    - `category`: 区域（Region）
    - `era`: 时代（可留空）
    - `source`: 来源（可留空）

前端 `app.js` 使用 `meta.category` 作为“Region”，已在 UI 中统一展示/筛选。

## 生成分类后的 questions.json（DeepSeek 分类）

1) 安装依赖（仅一次）

```bash
cd 模拟器网页版
python -m pip install -r requirements.txt
```

2) 配置 OpenRouter（若要真正使用 DeepSeek）

- 申请/获取 OpenRouter API Key: https://openrouter.ai/
- 在当前终端设置环境变量：
  - Windows PowerShell: `setx OPENROUTER_API_KEY "你的APIKey"`
  - 或当前会话：`$env:OPENROUTER_API_KEY = "你的APIKey"`
- 可选：设置站点信息（非必需）
  - `OPENROUTER_SITE_URL`, `OPENROUTER_SITE_NAME`
- 可选：选择模型（默认 `deepseek/deepseek-chat-v3.1:free`）
  - `setx OPENROUTER_MODEL "deepseek/deepseek-chat-v3.1:free"`

3) 放置原始题文本

- 确保 `extracted_questions_answers.txt` 位于同目录（已存在）。

4) 运行构建脚本

```bash
python build_db.py
```

- 若设置了 `OPENROUTER_API_KEY` 且网络可用，会调用 DeepSeek 进行 Region 分类。
- 若未设置或失败，会使用内置启发式（naive）分类。
- 输出文件：`questions.json`（前端可直接加载）。

## 启动本地判分服务（DeepSeek 判分）

```bash
python server.py
```

- 监听 `http://127.0.0.1:5057`
- 设置 `OPENROUTER_API_KEY` 可启用通过 OpenRouter 调用 DeepSeek 严格判分。
- 健康检查：`GET http://127.0.0.1:5057/health`
- 判分：`POST http://127.0.0.1:5057/grade`
  - JSON 请求：`{ question, expected, aliases, user_answer, strict }`

前端在练习结束后会自动调用该接口进行判分；如果服务不可用，会退回到本地的基本匹配。

## 前端加载已分类题库

- 打开 `index.html`（建议通过本地服务器打开，例如 VS Code Live Server）。
- 点击 “Fetch default” 按钮：优先加载同目录 `questions.json`；若不存在则回退加载 `extracted_questions_answers.txt` 并本地解析。
- “Region/Era/Source” 筛选均基于 `meta` 字段；其中 Region 映射自 `meta.category`。

## 变更摘要

- 统一 UI 用语：将“Category/All categories/No categories” 改为 “Region/All regions/No regions”。
- `app.js` 中：
  - 默认筛选与库筛选项文本改为 “All regions”。
  - 统计图空状态改为 “No regions”。
  - 初始时将库信息 Pills 中的“Categories:” 文案替换为 “Regions:”。
- 无需修改数据结构：`build_db.py` 输出与前端读取已对齐（`meta.category` 用作 Region）。

## 常见问题

- 未看到 Region：确认 `questions.json` 中每个 item 的 `meta.category` 已填入（构建脚本会写入）。
- DeepSeek 未生效：
  - 确认设置了 `OPENROUTER_API_KEY`。
  - Windows 设为当前会话可用：`$env:OPENROUTER_API_KEY = "..."` 后再运行脚本/服务。
  - 网络允许访问 `https://openrouter.ai/api/v1/chat/completions`。
- 直接打开本地文件无法 Fetch：请用 http(s) 打开页面（如 Live Server），或手动用“New set from file”导入。
