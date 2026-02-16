# IHBB Simulator Web

## 1. Project Overview
This repository provides a web-based IHBB practice simulator with:
- A browser frontend (`index.html`, `app.js`, `styles.css`) for setup, practice, review, and library management.
- A local Python server (`server.py`) that serves static files and provides answer grading APIs.
- A data build pipeline (`cleanquestions.py`, `build_db.py`) that converts raw text into `questions.json`.

Terminology note:
- The UI displays **Region**.
- Data is stored in `meta.category`.

## 2. Features
- Audio-based question practice with buzz flow and timed answer input.
- Region/Era/Source filtering and library management.
- Local fallback grading plus optional DeepSeek-powered grading.
- Question dataset build with optional DeepSeek region classification.
- Review tools (history, wrong-bank/SRS, export/import).

## 3. Repository Layout
- `index.html`: Main web page.
- `app.js`: Frontend logic (practice flow, import/export, filters, grading requests).
- `styles.css`: Frontend styles.
- `server.py`: Local HTTP server and grading endpoints.
- `cleanquestions.py`: Cleans raw extracted text into normalized QA text.
- `build_db.py`: Parses cleaned text and generates `questions.json`.
- `questions.json`: Built dataset consumed by the frontend.
- `extracted_questions_answers.txt`: Raw source text input.
- `cleaned_questions_answers.txt`: Cleaned intermediate file.
- `requirements.txt`: Python dependencies.

## 4. Prerequisites
- Windows PowerShell (primary examples below use PowerShell syntax).
- Python 3.8+ (recommended).
- Internet access only if you want DeepSeek API grading/classification.
- Optional environment variables:
  - `DEEPSEEK_API_KEY`
  - `DEEPSEEK_MODEL` (default: `deepseek-chat`)
  - `IHBB_SERVER_PORT` (default: `5057`)

## 5. Quick Start (Windows-first)
From the project root:

```powershell
cd C:\Users\alpac\Desktop\ihbb-simulator-web-main
python -m pip install -r requirements.txt
```

Optional (enable DeepSeek):

```powershell
$env:DEEPSEEK_API_KEY = "your_api_key"
$env:DEEPSEEK_MODEL = "deepseek-chat"
```

Build dataset:

```powershell
python cleanquestions.py
python build_db.py
```

Run app server:

```powershell
python server.py
```

Open:
- `http://127.0.0.1:5057`

## 6. Data Pipeline (main path)
Primary flow:
1. `extracted_questions_answers.txt` (raw text input)
2. `cleanquestions.py` -> writes `cleaned_questions_answers.txt`
3. `build_db.py` -> reads cleaned file, writes `questions.json`
4. Frontend loads `questions.json` via HTTP

Notes:
- `build_db.py` categorizes `meta.category` as Region.
- If `DEEPSEEK_API_KEY` is not set (or request fails), `build_db.py` falls back to heuristic region classification.

## 7. Running the App (`python server.py` primary)
`server.py` is the primary runtime path and does two jobs:
- Serves frontend/static files.
- Exposes grading endpoints used by the frontend.

Default bind:
- `http://127.0.0.1:5057`

Custom port example:

```powershell
$env:IHBB_SERVER_PORT = "5060"
python server.py
```

## 8. API Reference
### `GET /health`
- Purpose: health check.
- Response:

```json
{ "ok": true }
```

PowerShell example:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:5057/health" -Method Get
```

### `POST /grade`
- Purpose: grade a user answer.
- Request JSON fields:
  - `question` (string)
  - `expected` (string)
  - `aliases` (array of strings)
  - `user_answer` (string)
  - `strict` (boolean)

PowerShell example:

```powershell
$body = @{
  question = "Name this city that fought the Punic Wars with Rome."
  expected = "Carthage"
  aliases = @()
  user_answer = "Carthage"
  strict = $true
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "http://127.0.0.1:5057/grade" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body
```

Response JSON:
- `correct` (boolean)
- `reason` (string)

Behavior:
- With `DEEPSEEK_API_KEY`, grading uses DeepSeek API.
- Without it (or on API failure), grading falls back to local matcher logic.

## 9. `questions.json` Schema
Top-level object:
- `id`: string
- `name`: string
- `categories`: string array
- `items`: array of question objects

Question item object:
- `id`: string
- `question`: string
- `answer`: string
- `aliases`: string array
- `meta`:
  - `category`: string (Region in UI)
  - `era`: string
  - `source`: string

Example:

```json
{
  "id": "set_1234567890",
  "name": "IHBB Questions (categorized by region)",
  "categories": ["Europe", "East Asia"],
  "items": [
    {
      "id": "item_1",
      "question": "For the point, name this...",
      "answer": "Example Answer",
      "aliases": ["Alt Answer"],
      "meta": {
        "category": "Europe",
        "era": "",
        "source": ""
      }
    }
  ]
}
```

## 10. Troubleshooting
| Issue | Likely Cause | Fix |
|---|---|---|
| `DEEPSEEK_API_KEY not set` behavior | API key missing | Set `$env:DEEPSEEK_API_KEY` before running `build_db.py`/`server.py` |
| `questions.json` not loaded | File missing or not built yet | Run `python cleanquestions.py` then `python build_db.py` |
| Browser cannot fetch data when opening HTML directly | `file://` blocks fetch behavior | Run `python server.py` and use `http://127.0.0.1:5057` |
| Port already in use | Another process uses `5057` | Set `$env:IHBB_SERVER_PORT` to another port, then rerun |
| Grading endpoint unreachable | `server.py` not running | Start server and retry `/health` |

---

# IHBB 模拟器网页版（中文）

## 1. 项目概述
这个仓库是 IHBB 训练网页应用，包含：
- 前端（`index.html`、`app.js`、`styles.css`），用于设置、练习、复盘和题库管理。
- 本地 Python 服务（`server.py`），负责静态文件服务与判分 API。
- 数据构建流程（`cleanquestions.py`、`build_db.py`），把原始文本转换为 `questions.json`。

术语说明：
- 界面显示的是 **Region**。
- 数据字段里使用的是 `meta.category`。

## 2. 功能
- 音频读题 + 抢答流程 + 限时输入答案。
- 按 Region/Era/Source 筛选题目与管理题库。
- 本地判分回退 + 可选 DeepSeek 判分。
- 可选 DeepSeek 的 Region 分类构建流程。
- 复盘功能（历史记录、错题 SRS、导入导出）。

## 3. 仓库结构
- `index.html`：主页面。
- `app.js`：前端核心逻辑（练习流程、导入导出、筛选、判分请求）。
- `styles.css`：前端样式。
- `server.py`：本地 HTTP 服务与判分接口。
- `cleanquestions.py`：清洗原始题文，输出规范文本。
- `build_db.py`：解析清洗文本并生成 `questions.json`。
- `questions.json`：前端读取的题库文件。
- `extracted_questions_answers.txt`：原始输入文本。
- `cleaned_questions_answers.txt`：清洗后的中间文件。
- `requirements.txt`：Python 依赖。

## 4. 环境要求
- Windows PowerShell（以下命令优先用 PowerShell）。
- Python 3.8+（推荐）。
- 仅在使用 DeepSeek 判分/分类时需要联网。
- 可选环境变量：
  - `DEEPSEEK_API_KEY`
  - `DEEPSEEK_MODEL`（默认：`deepseek-chat`）
  - `IHBB_SERVER_PORT`（默认：`5057`）

## 5. 快速开始（Windows 优先）
在项目根目录执行：

```powershell
cd C:\Users\alpac\Desktop\ihbb-simulator-web-main
python -m pip install -r requirements.txt
```

可选（启用 DeepSeek）：

```powershell
$env:DEEPSEEK_API_KEY = "your_api_key"
$env:DEEPSEEK_MODEL = "deepseek-chat"
```

构建题库：

```powershell
python cleanquestions.py
python build_db.py
```

启动应用服务：

```powershell
python server.py
```

打开：
- `http://127.0.0.1:5057`

## 6. 数据流程（主路径）
主流程：
1. `extracted_questions_answers.txt`（原始文本）
2. `cleanquestions.py` -> 生成 `cleaned_questions_answers.txt`
3. `build_db.py` -> 读取清洗文本并生成 `questions.json`
4. 前端通过 HTTP 加载 `questions.json`

说明：
- `build_db.py` 会把 Region 写入 `meta.category`。
- 如果没有设置 `DEEPSEEK_API_KEY`（或调用失败），`build_db.py` 会回退到启发式分类。

## 7. 运行应用（以 `python server.py` 为主）
`server.py` 是主运行方式，同时负责：
- 提供前端静态资源。
- 提供前端使用的判分接口。

默认地址：
- `http://127.0.0.1:5057`

自定义端口示例：

```powershell
$env:IHBB_SERVER_PORT = "5060"
python server.py
```

## 8. API 说明
### `GET /health`
- 用途：健康检查。
- 返回：

```json
{ "ok": true }
```

PowerShell 示例：

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:5057/health" -Method Get
```

### `POST /grade`
- 用途：提交答案并判分。
- 请求 JSON 字段：
  - `question`（字符串）
  - `expected`（字符串）
  - `aliases`（字符串数组）
  - `user_answer`（字符串）
  - `strict`（布尔值）

PowerShell 示例：

```powershell
$body = @{
  question = "Name this city that fought the Punic Wars with Rome."
  expected = "Carthage"
  aliases = @()
  user_answer = "Carthage"
  strict = $true
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "http://127.0.0.1:5057/grade" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body
```

返回 JSON：
- `correct`（布尔值）
- `reason`（字符串）

行为说明：
- 设置 `DEEPSEEK_API_KEY` 时，使用 DeepSeek 判分。
- 未设置（或 API 失败）时，回退到本地匹配判分。

## 9. `questions.json` 结构
顶层对象：
- `id`：字符串
- `name`：字符串
- `categories`：字符串数组
- `items`：题目对象数组

每个题目对象：
- `id`：字符串
- `question`：字符串
- `answer`：字符串
- `aliases`：字符串数组
- `meta`：
  - `category`：字符串（UI 中显示为 Region）
  - `era`：字符串
  - `source`：字符串

示例：

```json
{
  "id": "set_1234567890",
  "name": "IHBB Questions (categorized by region)",
  "categories": ["Europe", "East Asia"],
  "items": [
    {
      "id": "item_1",
      "question": "For the point, name this...",
      "answer": "Example Answer",
      "aliases": ["Alt Answer"],
      "meta": {
        "category": "Europe",
        "era": "",
        "source": ""
      }
    }
  ]
}
```

## 10. 故障排查
| 问题 | 常见原因 | 处理方式 |
|---|---|---|
| 出现 `DEEPSEEK_API_KEY not set` 相关行为 | 没有设置 API Key | 运行 `build_db.py`/`server.py` 前先设置 `$env:DEEPSEEK_API_KEY` |
| `questions.json` 未加载 | 文件不存在或尚未构建 | 先执行 `python cleanquestions.py`，再执行 `python build_db.py` |
| 直接打开 HTML 无法加载数据 | `file://` 下浏览器限制 fetch | 启动 `python server.py`，通过 `http://127.0.0.1:5057` 访问 |
| 端口被占用 | `5057` 已被其他程序使用 | 设置 `$env:IHBB_SERVER_PORT` 为其他端口后重启服务 |
| 判分接口不可用 | `server.py` 未运行 | 启动服务并先访问 `/health` 检查 |
