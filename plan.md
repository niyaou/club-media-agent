# Club Media Agent — 行动指南

> 目标读者：CLI AI coding agent。按 Step 顺序逐步执行即可完成整个项目。

---

## 1. 项目概述

本地运行的图片智能筛选系统。输入一个网球俱乐部的图片文件夹，自动完成：去重 → 多维评分 → 主题归类 → 保留/废弃决策 → 文件归档 → 结论报告。另提供独立的人脸聚类子命令，按人物归档照片。

## 2. 技术栈

| 用途       | 选型                                          |
| ---------- | --------------------------------------------- |
| 语言       | Python ≥ 3.10                                 |
| 构建       | pip + setuptools（pyproject.toml）            |
| CLIP       | open_clip_torch ≥ 3.2.0（ViT-B-32 / laion2b_s34b_b79k） |
| 审美评分   | LAION Aesthetic Predictor v1（`sa_0_4_vit_b_32_linear.pth`，Linear(512,1)，与 ViT-B-32 匹配） |
| 人脸       | insightface（独立子命令，不在主流程）         |
| pHash      | imagehash                                     |
| 缓存       | Python 标准库 sqlite3                         |
| CLI        | typer                                         |
| 进度条     | rich                                          |
| 报告模板   | jinja2                                        |
| 配置       | pyyaml + pydantic                             |
| 图片       | Pillow                                        |
| 图片格式   | .jpg .jpeg .png .webp（不支持 HEIC / RAW）   |

> torch、torchvision、numpy、timm、huggingface-hub 等由 open_clip_torch 自动依赖，无需显式声明。

## 3. 架构总览

```
                        ┌──────────────┐
                        │  club-media  │  CLI 入口（Typer）
                        │     run      │  = scan + analyze + output
                        └──────┬───────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
        ┌──────────┐    ┌───────────┐    ┌───────────┐
        │   scan   │    │  analyze  │    │  output   │
        │          │    │           │    │           │
        │ scanner  │    │ dedup     │    │ describer │
        │ embedder │    │ scoring   │    │ archiver  │
        └────┬─────┘    │ theme     │    │ reporter  │
             │          │ decision  │    └─────┬─────┘
             │          └─────┬─────┘          │
             │                │                │
             └───────►  SQLite 缓存  ◄─────────┘
                       (store.sqlite)

        ┌──────────┐
        │  faces   │  独立子命令（InsightFace 聚类）
        └──────────┘
```

**模块间解耦规则：** 所有模块通过 SQLite 缓存交换数据。每个子命令可独立运行、重复运行。

## 4. 目标产物

### 4.1 项目结构

```
club-media-agent/
├── pyproject.toml
├── config.yaml              # 默认配置
├── themes.yaml              # 主题定义
├── src/
│   └── club_media/
│       ├── __init__.py
│       ├── cli.py           # Typer CLI 入口，定义所有子命令
│       ├── pipeline.py      # run 命令的编排：顺序调用 scan → analyze → output
│       ├── scanner.py       # scan：扫描文件夹 + EXIF + 缩略图 + pHash
│       ├── embedder.py      # scan：CLIP 向量化
│       ├── dedup.py         # analyze：去重
│       ├── scoring.py       # analyze：多维评分（Q/T/S/A + 综合分）
│       ├── theme.py         # analyze：主题识别
│       ├── decision.py      # analyze：决策引擎
│       ├── describer.py     # output：图片描述生成（模板拼接）
│       ├── archiver.py      # output：文件归档 + manifest
│       ├── reporter.py      # output / report：结论文档
│       ├── faces.py         # faces：人脸聚类（InsightFace）
│       ├── cache.py         # SQLite 缓存读写层
│       ├── models.py        # Pydantic 数据模型 + Enum
│       └── config.py        # 配置加载与 Pydantic 校验
└── templates/
    ├── conclusion.md.j2
    └── conclusion.html.j2
```

### 4.2 输出目录结构

运行后在 `output_dir` 下生成：

```
output/
├── keep/
│   ├── match/
│   ├── training/
│   ├── award/
│   ├── group_photo/
│   ├── venue_brand/
│   └── uncategorized/
├── review/
├── discard/
│   ├── Q_BLUR/
│   ├── Q_EXPOSURE_BAD/
│   ├── Q_LOW_RESOLUTION/
│   ├── A_LOW_AESTHETIC/
│   ├── S_NSFW/
│   ├── T_OFF_TOPIC/
│   ├── DUP_REDUNDANT/
│   └── SCORE_BELOW_THRESHOLD/
├── faces/                      # faces 子命令输出
│   ├── person_1/
│   ├── person_2/
│   └── unknown/
├── results.jsonl               # 每张图完整评分记录
├── report/
│   ├── conclusion.md
│   └── conclusion.html
├── manifests/
│   └── actions.jsonl           # 每张图的决策 + 来源 + 去向
└── cache/
    ├── store.sqlite
    └── thumbs/
```

## 5. CLI 命令参考

### 公共选项（所有子命令均可用）

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--config` | PATH | `./config.yaml` | 配置文件路径 |
| `--verbose / -v` | FLAG | `false` | 详细日志输出 |

---

### `club-media run` — 完整流水线

等价于依次执行 `scan` → `analyze` → `output`。

| 参数/选项 | 类型 | 必填 | 默认值 | 说明 |
|-----------|------|------|--------|------|
| `--input / -i` | PATH | 是 | config.input_dir | 图片文件夹路径 |
| `--output / -o` | PATH | 否 | config.output_dir | 输出目录路径 |
| `--dry-run` | FLAG | 否 | `false` | 仅评分和生成报告，不复制/移动文件 |
| `--incremental` | FLAG | 否 | `false` | 跳过已处理的图片（基于缓存） |
| `--extra-themes` | PATH | 否 | 无 | 额外主题文件路径，与默认 themes.yaml 合并 |

```bash
# 基础用法
club-media run -i ./photos

# 试运行 + 增量
club-media run -i ./photos --dry-run --incremental

# 指定额外主题
club-media run -i ./photos --extra-themes ./my_themes.yaml
```

---

### `club-media scan` — 扫描 + 向量化

递归扫描图片文件夹，提取元数据、生成缩略图、计算 CLIP embedding，写入缓存。

| 参数/选项 | 类型 | 必填 | 默认值 | 说明 |
|-----------|------|------|--------|------|
| `--input / -i` | PATH | 是 | config.input_dir | 图片文件夹路径 |
| `--output / -o` | PATH | 否 | config.output_dir | 输出目录（缓存写在此目录下） |

```bash
club-media scan -i ./photos
```

---

### `club-media analyze` — 去重 + 评分 + 决策

基于缓存中的扫描数据和 embedding，执行去重、多维评分、主题识别、决策。

| 参数/选项 | 类型 | 必填 | 默认值 | 说明 |
|-----------|------|------|--------|------|
| `--output / -o` | PATH | 否 | config.output_dir | 输出目录（读写缓存） |
| `--extra-themes` | PATH | 否 | 无 | 额外主题文件路径 |

```bash
club-media analyze
club-media analyze --extra-themes ./event_themes.yaml
```

**前置条件：** 必须先运行过 `scan`。

---

### `club-media output` — 归档 + 描述 + 报告

基于缓存中的评分和决策数据，执行文件归档、描述生成、报告生成。

| 参数/选项 | 类型 | 必填 | 默认值 | 说明 |
|-----------|------|------|--------|------|
| `--output / -o` | PATH | 否 | config.output_dir | 输出目录 |
| `--dry-run` | FLAG | 否 | `false` | 仅生成 manifest 和报告，不复制/移动文件 |

```bash
club-media output
club-media output --dry-run
```

**前置条件：** 必须先运行过 `analyze`。

---

### `club-media faces` — 人脸聚类归档

从 keep 图片中检测人脸，无监督聚类，按人物归档到子文件夹。独立于主流程。

| 参数/选项 | 类型 | 必填 | 默认值 | 说明 |
|-----------|------|------|--------|------|
| `--output / -o` | PATH | 否 | config.output_dir | 输出目录 |
| `--threshold / -t` | FLOAT | 否 | config.faces.distance_threshold | 聚类距离阈值（越小越严格） |

```bash
# 需先安装人脸依赖：pip install -e ".[faces]"
club-media faces
club-media faces -t 0.5
```

**前置条件：** 必须先运行过 `output`（需要 keep 目录下的图片）。

---

### `club-media report` — 重新生成报告

基于缓存中的已有数据重新生成结论文档，不重新评分。

| 参数/选项 | 类型 | 必填 | 默认值 | 说明 |
|-----------|------|------|--------|------|
| `--output / -o` | PATH | 否 | config.output_dir | 输出目录 |

```bash
club-media report
```

**前置条件：** 缓存中有评分和决策数据。

---

### `club-media inspect` — 查看单张图片评分

从缓存中读取指定图片的全部评分和决策信息，用 Rich 表格打印。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `image_path` | PATH | 是 | 图片文件路径（计算 SHA256 后查缓存） |

```bash
club-media inspect ./photos/IMG_001.jpg
```

输出示例：
```
┌──────────────────────────────────────┐
│ IMG_001.jpg 评分详情                 │
├───────────────────┬──────────────────┤
│ 文件 ID           │ sha256:a1b2c3... │
│ 尺寸              │ 4032×3024 (12.2MP)│
│ 拍摄时间          │ 2024-01-15 14:30 │
├───────────────────┼──────────────────┤
│ Q 质量            │ 7.2              │
│   sharpness       │ 8.1              │
│   exposure        │ 7.0              │
│   noise           │ 6.5              │
│   resolution      │ 10.0             │
├───────────────────┼──────────────────┤
│ T 主题            │ 8.1              │
│   tennis_relevance│ 8.5              │
│   action_moment   │ 7.5              │
├───────────────────┼──────────────────┤
│ S 合规            │ 6.5              │
│   nsfw_safe       │ 9.2              │
│   brand_clean     │ 3.8              │
├───────────────────┼──────────────────┤
│ A 审美            │ 7.8              │
│   aesthetic_model  │ 7.5              │
│   aesthetic_rules  │ 8.1              │
│     composition   │ 8.5              │
│     color_harmony │ 7.8              │
│     color_saturat.│ 8.0              │
│     lighting      │ 7.2              │
│     center_of_int.│ 9.0              │
│     bg_simplicity │ 8.1              │
├───────────────────┼──────────────────┤
│ 综合 (public)     │ 73.5             │
│ 综合 (client)     │ 70.2             │
├───────────────────┼──────────────────┤
│ 主题              │ match (0.82)     │
│ 决策              │ keep             │
└───────────────────┴──────────────────┘
```

## 6. 配置文件

### config.yaml

```yaml
input_dir: ./photos
output_dir: ./output
file_action: copy                  # copy | move | symlink

clip_model: ViT-B-32
clip_pretrained: laion2b_s34b_b79k
batch_size: 32
device: auto                       # auto | cpu | cuda

thumbnail_size: 512

dedup:
  phash_threshold: 8               # 汉明距离 ≤ 此值视为重复
  cosine_threshold: 0.95           # embedding 余弦相似度 ≥ 此值视为重复

scoring_weights:
  public:  { Q: 0.30, T: 0.20, S: 0.25, A: 0.25 }
  client:  { Q: 0.35, T: 0.20, S: 0.30, A: 0.15 }

thresholds:
  keep_min: 55
  review_min: 40
  nsfw_safe_min: 3
  sharpness_min: 3
  exposure_min: 3
  resolution_min: 3
  aesthetic_min: 3
  tennis_relevance_min: 2

description_mode: template         # template（第一版仅此模式）

faces:
  distance_threshold: 0.6          # 人脸聚类距离阈值

report:
  max_examples_per_reason: 5
```

### themes.yaml

```yaml
themes:
  match:
    prompts:
      - "a tennis match in progress"
      - "tennis players competing on court"
    min_score: 0.25
  training:
    prompts:
      - "tennis training session"
      - "coach teaching tennis"
    min_score: 0.25
  award:
    prompts:
      - "award ceremony with trophy"
      - "prize giving celebration"
    min_score: 0.25
  group_photo:
    prompts:
      - "group photo of people posing together"
      - "team photo"
    min_score: 0.25
  venue_brand:
    prompts:
      - "tennis court venue"
      - "sports facility exterior"
    min_score: 0.25
```

## 7. 数据模型

以下是 `models.py` 中需要定义的 Pydantic 模型和枚举。

### 废弃原因枚举

```python
class DiscardReason(str, Enum):
    Q_BLUR                = "Q_BLUR"
    Q_EXPOSURE_BAD        = "Q_EXPOSURE_BAD"
    Q_LOW_RESOLUTION      = "Q_LOW_RESOLUTION"
    A_LOW_AESTHETIC       = "A_LOW_AESTHETIC"
    S_NSFW                = "S_NSFW"
    T_OFF_TOPIC           = "T_OFF_TOPIC"
    DUP_REDUNDANT         = "DUP_REDUNDANT"
    SCORE_BELOW_THRESHOLD = "SCORE_BELOW_THRESHOLD"
```

### 决策枚举

```python
class Decision(str, Enum):
    KEEP    = "keep"
    REVIEW  = "review"
    DISCARD = "discard"
```

### 图片记录模型

每张图片在整个流水线中累积的所有数据，最终写入 `results.jsonl`：

```python
class ImageRecord(BaseModel):
    file_id: str                    # SHA256
    src_path: str                   # 原始路径
    width: int
    height: int
    megapixels: float
    exif_time: str | None
    camera: str | None
    phash: str
    thumb_path: str

    # M2 向量化（不写入 jsonl，仅缓存在 sqlite）
    # embedding: list[float]

    # M3 去重
    dup_group_id: str | None
    is_representative: bool

    # M4 评分子项（均 0-10）
    sharpness: float
    exposure: float
    noise: float
    resolution: float
    Q: float                        # 质量总分

    tennis_relevance: float
    action_moment: float
    T: float                        # 主题总分

    nsfw_safe: float
    brand_clean: float
    S: float                        # 合规总分

    aesthetic_model: float
    aesthetic_rules: float           # 6 维均值
    ar_composition: float
    ar_color_harmony: float
    ar_color_saturation: float
    ar_lighting: float
    ar_center_of_interest: float
    ar_bg_simplicity: float
    A: float                        # 审美总分

    score_public: float             # 0-100
    score_client: float             # 0-100

    # M5 主题
    pred_theme: str
    theme_confidence: float

    # M6 决策
    decision: Decision
    discard_reasons: list[DiscardReason]

    # M8 描述（仅 keep）
    description_zh: str | None

    # M9 归档
    dest_path: str | None
```

## 8. SQLite 缓存 Schema

`cache/store.sqlite` 中的表设计：

```sql
-- 扫描元数据
CREATE TABLE IF NOT EXISTS scan (
    file_id   TEXT PRIMARY KEY,
    src_path  TEXT NOT NULL,
    width     INTEGER,
    height    INTEGER,
    megapixels REAL,
    exif_time TEXT,
    camera    TEXT,
    phash     TEXT,
    thumb_path TEXT
);

-- CLIP embedding
CREATE TABLE IF NOT EXISTS embedding (
    file_id   TEXT PRIMARY KEY,
    vector    BLOB NOT NULL          -- numpy float32 tobytes()
);

-- 评分 + 决策（analyze 阶段写入）
CREATE TABLE IF NOT EXISTS analysis (
    file_id           TEXT PRIMARY KEY,
    dup_group_id      TEXT,
    is_representative INTEGER,       -- 0/1
    sharpness         REAL,
    exposure          REAL,
    noise             REAL,
    resolution        REAL,
    Q                 REAL,
    tennis_relevance  REAL,
    action_moment     REAL,
    T                 REAL,
    nsfw_safe         REAL,
    brand_clean       REAL,
    S                 REAL,
    aesthetic_model          REAL,
    aesthetic_rules          REAL,
    ar_composition           REAL,
    ar_color_harmony         REAL,
    ar_color_saturation      REAL,
    ar_lighting              REAL,
    ar_center_of_interest    REAL,
    ar_bg_simplicity         REAL,
    A                        REAL,
    score_public      REAL,
    score_client      REAL,
    pred_theme        TEXT,
    theme_confidence  REAL,
    decision          TEXT,          -- keep/review/discard
    discard_reasons   TEXT           -- JSON array
);
```

`cache.py` 提供读写这三张表的函数。增量逻辑：插入前检查 `file_id` 是否已存在，存在则跳过。

## 9. 实施步骤

---

### Step 1: 项目脚手架

**创建文件：**
- `pyproject.toml`
- `config.yaml`（内容见 Section 6）
- `themes.yaml`（内容见 Section 6）
- `src/club_media/__init__.py`（空文件）
- `templates/`（空目录，后续步骤填充）

**pyproject.toml 要点：**

```toml
[project]
name = "club-media-agent"
version = "0.1.0"
requires-python = ">=3.10"
dependencies = [
    "open-clip-torch>=3.2.0",
    "Pillow>=10.0",
    "imagehash>=4.3",
    "pydantic>=2.0",
    "pyyaml>=6.0",
    "typer>=0.9",
    "rich>=13.0",
    "jinja2>=3.1",
]

[project.optional-dependencies]
faces = ["insightface>=0.7", "onnxruntime>=1.16"]

[project.scripts]
club-media = "club_media.cli:app"

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.backends._legacy:_Backend"

[tool.setuptools.packages.find]
where = ["src"]
```

> insightface 放在 optional-dependencies 中，主流程不需要安装它。安装人脸功能：`pip install -e ".[faces]"`

**完成标志：** `pip install -e .` 成功，`club-media --help` 有输出。

---

### Step 2: 数据模型 + 配置

**创建文件：**
- `src/club_media/models.py`
- `src/club_media/config.py`

**models.py 规则：**
- 定义 `DiscardReason`、`Decision` 枚举（见 Section 7）
- 定义 `ImageRecord` Pydantic 模型（见 Section 7）
- 所有可选字段用 `None` 默认值，方便流水线各阶段逐步填充

**config.py 规则：**
- 用 Pydantic 模型校验 `config.yaml` 和 `themes.yaml`
- 提供 `load_config(path)` 函数，返回校验后的配置对象
- 提供 `load_themes(path, extra_path=None)` 函数：加载 themes.yaml，若 `extra_path` 存在则合并（同名主题用 extra 覆盖，新主题追加）
- `device: auto` 时自动检测 CUDA 可用性
- 所有阈值在配置模型中有默认值（与 Section 6 一致）

**完成标志：** 能加载 config.yaml 和 themes.yaml，校验通过。

---

### Step 3: SQLite 缓存层

**创建文件：**
- `src/club_media/cache.py`

**规则：**
- 管理 `cache/store.sqlite`，三张表（scan、embedding、analysis）见 Section 8
- 自动建表（IF NOT EXISTS）
- 提供增量写入：写入前按 `file_id` 检查是否已存在
- embedding 存储：`numpy.ndarray.tobytes()` 写入 BLOB，读取时 `numpy.frombuffer()`
- 提供批量读取函数，返回字典列表
- 提供 `get_unprocessed_ids(table)` → 返回在 scan 表中但不在指定表中的 file_id 列表（用于增量）

**完成标志：** 能建表、增量写入、读取，embedding 序列化/反序列化正确。

---

### Step 4: 扫描与预处理（scanner.py）

**创建文件：**
- `src/club_media/scanner.py`

**做什么：**
递归扫描输入文件夹，对每张图片提取元数据，写入缓存。

**规则：**
- 递归扫描，过滤后缀 `.jpg .jpeg .png .webp`（大小写不敏感）
- 每张图片：
  - 计算 SHA256 作为 `file_id`
  - 用 Pillow 打开，读取尺寸
  - 读取 EXIF（拍摄时间、旋转方向、相机型号）
  - 按 EXIF 旋转校正
  - 生成缩略图（长边 ≤ thumbnail_size），保存到 `cache/thumbs/{file_id}.jpg`
  - 用 imagehash 计算 pHash（字符串形式）
- 结果写入 SQLite `scan` 表
- 打不开/损坏的文件：跳过，用 Rich console 输出警告，继续处理下一张
- 用 Rich 进度条显示进度
- 增量：scan 表已有的 file_id 跳过

**完成标志：** 扫描一个含图片的文件夹，scan 表写入正确，缩略图生成。

---

### Step 5: CLIP 向量化（embedder.py）

**创建文件：**
- `src/club_media/embedder.py`

**做什么：**
对 scan 表中尚未有 embedding 的图片批量计算 CLIP embedding。

**规则：**
- 用 `open_clip.create_model_and_transforms()` 加载模型，模型名和预训练权重来自配置
- 根据 `device` 配置决定 CPU/CUDA
- 从缓存取 `get_unprocessed_ids("embedding")`，按 `batch_size` 分批
- 每批：加载缩略图 → preprocess → model.encode_image → 归一化 → 写入 embedding 表
- 文本 embedding 也在此模块提供：`encode_texts(texts: list[str]) -> ndarray`，供后续评分和主题识别使用
- Rich 进度条

**完成标志：** embedding 表写入正确，维度为 512。

---

### Step 6: 去重（dedup.py）

**创建文件：**
- `src/club_media/dedup.py`

**做什么：**
基于 pHash 和 embedding 余弦相似度，识别重复图片组，每组选一张代表。

**规则：**
- 两级去重，任一命中即为同组：
  - pHash 汉明距离 ≤ `dedup.phash_threshold`
  - embedding 余弦相似度 ≥ `dedup.cosine_threshold`
- 用 Union-Find 合并重复组
- 每组选 `sharpness` 最高的为代表图（sharpness 此时还没算，用 Laplacian 方差临时算一次，或先跑一遍简单清晰度检测）
  - 简化方案：用 Laplacian 方差作为选代表的依据，此处内联计算即可，不必依赖 scoring 模块
- 输出：为每张图写入 `dup_group_id` 和 `is_representative` 到 analysis 表（仅这两个字段，其余字段在 scoring 阶段填充）

**完成标志：** 相似图片被分为同组，每组有且只有一个 representative。

---

### Step 7: 多维评分（scoring.py）

**创建文件：**
- `src/club_media/scoring.py`

**做什么：**
对每张图片计算 Q/T/S/A 四维评分及综合得分。

#### 质量评分 Q（0-10）

| 子项 | 计算方法 |
|------|---------|
| sharpness | `cv2.Laplacian(gray, cv2.CV_64F).var()`，用 sigmoid 映射到 0-10：`10 / (1 + exp(-0.005 * (val - 500)))` |
| exposure | 灰度直方图均值 `mean`，偏离 128 越远越差：`10 * (1 - abs(mean - 128) / 128)` |
| noise | 高频能量：对灰度图做 3×3 Laplacian，取标准差 `std`。`noise_score = 10 / (1 + exp(0.1 * (std - 30)))`（噪点越多 std 越大，分越低） |
| resolution | 像素数映射：`< 1MP → 2`，`1-4MP → 5`，`4-12MP → 8`，`≥ 12MP → 10` |

`Q = mean(sharpness, exposure, noise, resolution)`

#### 主题与新闻价值 T（0-10）

| 子项 | 计算方法 |
|------|---------|
| tennis_relevance | 图片 embedding 与以下文本 embedding 的最大余弦相似度 × 10：`["tennis match", "tennis player", "tennis court", "tennis training"]` |
| action_moment | 图片 embedding 与以下文本 embedding 的最大余弦相似度 × 10：`["athlete in action", "dynamic sports moment", "winning celebration", "intense competition"]` |

`T = 0.6 × tennis_relevance + 0.4 × action_moment`

#### 合规评分 S（0-10）

| 子项 | 计算方法 |
|------|---------|
| nsfw_safe | CLIP zero-shot：图片 embedding 与 `"a safe appropriate photo"` 的余弦相似度 vs `"an inappropriate nsfw photo"` 的余弦相似度。取 softmax 后 safe 概率 × 10 |
| brand_clean | 图片 embedding 与 `"a clean professional sports photograph"` 的余弦相似度 × 10 |

`S = 0.5 × nsfw_safe + 0.5 × brand_clean`

#### 审美评分 A（0-10）

`A = 0.5 × aesthetic_model + 0.5 × aesthetic_rules`

**aesthetic_model**（0-10）：LAION Aesthetic Predictor v1，与 ViT-B-32 匹配。

- 权重文件：`sa_0_4_vit_b_32_linear.pth`
- 下载地址：`https://github.com/LAION-AI/aesthetic-predictor/raw/main/sa_0_4_vit_b_32_linear.pth`
- 架构：`nn.Linear(512, 1)`，输入 CLIP embedding，输出 1-10 分
- 加载方式：`m = nn.Linear(512, 1); m.load_state_dict(torch.load(path)); m.eval()`
- 推理：`score = m(embedding).item()`，clamp 到 0-10
- 零训练，直接用预训练权重

**aesthetic_rules**（0-10）：基于 PPA（美国职业摄影师协会）12 项标准中可自动化的 6 个维度。

| 维度 | PPA 对应 | 计算方法 |
|------|---------|---------|
| composition | Composition（构图） | 三分法偏离度：将图片分为 3×3 网格，检测亮度/边缘主体区域重心，计算到最近三分线交叉点的归一化距离 `d`。`score = 10 × (1 - d)` |
| color_harmony | Color Balance（色彩和谐） | HSV 空间 H 通道直方图，计算主色调占比 `dominant_ratio`（最高 bin 占比）和色相分散度。主色调集中且饱和度适中得高分：`score = 10 × dominant_ratio × saturation_factor`，其中 `saturation_factor` 对 S 通道均值用高斯映射（峰值在 0.5） |
| color_saturation | — | HSV 空间 S 通道均值 `s_mean`，用高斯映射（峰值 0.45，σ=0.2）：`score = 10 × exp(-((s_mean - 0.45) / 0.2)²)`。过低（灰暗）或过高（过饱和）都扣分 |
| lighting | Lighting（光影） | 灰度直方图的高光区（>200）和阴影区（<50）像素占比。两者均衡时得高分。`contrast = std(gray) / 64`（归一化到 0-1），`hl_ratio = pixels>200 / total`，`sh_ratio = pixels<50 / total`。`score = 10 × contrast × (1 - abs(hl_ratio - sh_ratio))` |
| center_of_interest | Center of Interest（视觉焦点） | 用 Laplacian 能量图检测焦点区域，计算焦点区域（能量 top 10%）的空间集中度 `concentration`（标准差的倒数归一化）。焦点越集中分越高：`score = 10 × concentration` |
| bg_simplicity | Presentation/相关 | 背景简洁度：Canny 边缘像素占比 `edge_ratio`。`score = 10 × (1 - min(edge_ratio / 0.15, 1))`。边缘密度 ≥ 15% 时得 0 分 |

`aesthetic_rules = mean(composition, color_harmony, color_saturation, lighting, center_of_interest, bg_simplicity)`

#### 综合得分（0-100）

```
score_public = 100 × (0.30×Q + 0.20×T + 0.25×S + 0.25×A)
score_client = 100 × (0.35×Q + 0.20×T + 0.30×S + 0.15×A)
```

**规则：**
- 所有评分均 clamp 到 0-10 范围
- 从 embedding 表读取向量，从 scan 表读取缩略图路径
- 文本 embedding 在评分开始时一次性计算并缓存（调用 embedder 的 `encode_texts`）
- 结果更新到 analysis 表对应行（Step 6 已创建的行）
- 尚未在 analysis 表中的图片（非重复图），先创建行再写入

**完成标志：** analysis 表所有图片都有完整评分。

---

### Step 8: 主题识别 + 决策引擎（theme.py + decision.py）

**创建文件：**
- `src/club_media/theme.py`
- `src/club_media/decision.py`

#### theme.py

**做什么：**
基于 CLIP embedding 和 themes.yaml 中的 prompts，为每张图片分配主题。

**规则：**
- 通过 `load_themes()` 加载合并后的主题列表（默认 + extra-themes）
- 为每个主题的所有 prompts 计算文本 embedding
- 每张图片 embedding 与所有主题的所有 prompt embedding 计算余弦相似度
- 取全局最大相似度对应的主题
- 若最大相似度 < 该主题的 `min_score` → `pred_theme = "uncategorized"`
- 结果写入 analysis 表的 `pred_theme` 和 `theme_confidence`

#### decision.py

**做什么：**
基于评分和阈值，为每张图片做 keep/review/discard 决策。

**决策规则（按优先级从高到低，命中即停止）：**

| 优先级 | 条件 | 决策 | 原因代码 |
|--------|------|------|---------|
| 1 | nsfw_safe < thresholds.nsfw_safe_min | discard | S_NSFW |
| 2 | is_representative = false | discard | DUP_REDUNDANT |
| 3 | sharpness < thresholds.sharpness_min | discard | Q_BLUR |
| 4 | exposure < thresholds.exposure_min | discard | Q_EXPOSURE_BAD |
| 5 | resolution < thresholds.resolution_min | discard | Q_LOW_RESOLUTION |
| 6 | A < thresholds.aesthetic_min | discard | A_LOW_AESTHETIC |
| 7 | tennis_relevance < thresholds.tennis_relevance_min | discard | T_OFF_TOPIC |
| 8 | score_public ≥ thresholds.keep_min | **keep** | — |
| 9 | score_public ≥ thresholds.review_min | **review** | — |
| 10 | 其余 | discard | SCORE_BELOW_THRESHOLD |

**规则：**
- 一张图可以命中多条 discard 规则，`discard_reasons` 收集所有命中的原因代码
- `decision` 取最高优先级命中的结果
- 所有阈值从 config 读取
- 结果写入 analysis 表的 `decision` 和 `discard_reasons`

**完成标志：** analysis 表每行都有 `pred_theme`、`decision`、`discard_reasons`。

---

### Step 9: 描述 + 归档 + 报告（describer.py + archiver.py + reporter.py）

**创建文件：**
- `src/club_media/describer.py`
- `src/club_media/archiver.py`
- `src/club_media/reporter.py`
- `templates/conclusion.md.j2`
- `templates/conclusion.html.j2`

#### describer.py

**做什么：**
为 decision=keep 的图片生成中文描述。

**模板拼接规则：**
- 输入：从 analysis 表读取该图片的全部评分数据
- 主题中文映射：`match→比赛, training→训练, award→颁奖, group_photo→合影, venue_brand→场馆`
- 质量等级：Q ≥ 8 → "优秀"，≥ 6 → "良好"，≥ 4 → "一般"，< 4 → "较差"
- 输出示例：`"这是一张网球比赛场景的照片。画面捕捉到运动员的精彩瞬间，图片质量良好，审美评分7.2/10。适合用于新闻类素材。"`
- 写入 analysis 表 `description_zh`（需加列或用 results.jsonl 输出时拼接）

> 描述不需要非常复杂，能给下游大模型足够的上下文即可。

#### archiver.py

**做什么：**
按决策结果将图片归档到对应目录，并生成 manifest。

**规则：**
- keep → `output/keep/{pred_theme}/{原文件名}`
- review → `output/review/{原文件名}`
- discard → `output/discard/{首要原因代码}/{原文件名}`
- 文件名冲突时追加 `_1`, `_2` 后缀
- 操作方式由 `file_action` 配置决定（copy / move / symlink）
- `--dry-run` 模式：不执行文件操作，只写 manifest
- 生成 `manifests/actions.jsonl`，每行格式：

```json
{
  "file_id": "sha256...",
  "src": "photos/2024-01-15/IMG_001.jpg",
  "decision": "keep",
  "dest": "output/keep/match/IMG_001.jpg",
  "scores": {"Q": 7.2, "T": 8.1, "S": 6.5, "A": 7.8, "public": 73.5, "client": 70.2},
  "discard_reasons": [],
  "pred_theme": "match",
  "description_zh": "...",
  "timestamp": "2024-01-20T14:30:00"
}
```

- 同时生成 `results.jsonl`：每张图片一行完整的 ImageRecord JSON

#### reporter.py

**做什么：**
基于缓存数据生成结论文档。

**报告内容结构：**

1. **筛选概览**：总数 / keep / review / discard 数量与百分比
2. **废弃原因统计**：按数量降序列表
3. **每类原因示例**：每类最多 `report.max_examples_per_reason` 张缩略图（复制到 `report/` 目录下内嵌）
4. **主题分布**：各主题 keep 图片数量
5. **拍摄建议**：基于废弃原因占比自动生成
   - Q_BLUR 占比 > 30% → "建议使用更快快门速度或三脚架"
   - Q_EXPOSURE_BAD > 20% → "建议启用曝光补偿或包围曝光"
   - A_LOW_AESTHETIC > 25% → "建议注意构图和背景简洁"
   - DUP_REDUNDANT > 40% → "拍摄时减少连拍数量"

**规则：**
- 用 Jinja2 模板渲染
- 输出 `conclusion.md` 和 `conclusion.html`
- HTML 版本缩略图用 `<img>` 标签引用相对路径
- MD 版本缩略图用 `![](path)` 语法

**Jinja2 模板骨架（conclusion.md.j2）：**

```
# 图片筛选结论报告

生成时间：{{ timestamp }}

## 概览

- 扫描总数：{{ total }}
- 保留：{{ keep_count }}（{{ keep_pct }}%）
- 复核：{{ review_count }}（{{ review_pct }}%）
- 废弃：{{ discard_count }}（{{ discard_pct }}%）

## 废弃原因统计

{% for reason, count in discard_stats %}
- {{ reason }}：{{ count }} 张（{{ (count / discard_count * 100) | round(1) }}%）
{% endfor %}

## 废弃原因示例

{% for reason, examples in discard_examples.items() %}
### {{ reason }}

{% for img in examples %}
![{{ img.file_id }}]({{ img.thumb_path }})
{% endfor %}
{% endfor %}

## 主题分布

{% for theme, count in theme_stats %}
- {{ theme }}：{{ count }} 张
{% endfor %}

## 拍摄建议

{% for tip in tips %}
- {{ tip }}
{% endfor %}
```

HTML 模板类似结构，用基础 CSS 美化即可。

**完成标志：** keep/review/discard 目录下有文件，manifest 和 report 生成。

---

### Step 10: 流水线编排 + CLI 入口（pipeline.py + cli.py）

**创建文件：**
- `src/club_media/pipeline.py`
- `src/club_media/cli.py`

#### pipeline.py

**做什么：**
编排 `run` 命令的完整流水线。

**规则：**
- 按顺序调用：scanner → embedder → dedup → scoring → theme → decision → describer → archiver → reporter
- 每个模块通过函数调用，传入 config 对象
- `--incremental`：每个模块内部自行处理增量（基于缓存层的 `get_unprocessed_ids`）
- `--dry-run`：传给 archiver，其余模块正常执行
- 任何模块失败不阻断后续步骤（try/except + 记录错误）

#### cli.py

**做什么：**
Typer 应用，定义所有子命令。

**规则：**
- `app = typer.Typer()`
- 每个子命令的参数定义见 Section 5
- 公共参数用 `typer.Option` 定义：`--config`, `--verbose`
- `--extra-themes` 出现在 `run` 和 `analyze` 子命令中，传递给 `load_themes()`
- `run` 调用 `pipeline.run_full()`
- `scan` 调用 scanner + embedder
- `analyze` 调用 dedup + scoring + theme + decision
- `output` 调用 describer + archiver + reporter
- `report` 仅调用 reporter
- `inspect` 从缓存读取单张图片数据，用 Rich 表格打印评分详情（格式见 Section 5）
- `faces` 调用 faces 模块

**完成标志：** `club-media run --input <测试文件夹>` 能跑通整个流程。

---

### Step 11: 人脸聚类（faces.py）— 独立功能

**创建文件：**
- `src/club_media/faces.py`

**做什么：**
从 keep 图片中检测人脸、提取 embedding、无监督聚类、按人物归档。

**前置条件：** `pip install -e ".[faces]"`（安装 insightface + onnxruntime）

**规则：**
- 用 InsightFace 的 `FaceAnalysis` 检测人脸并提取 512 维 embedding
- 对所有人脸 embedding 做层次聚类（scipy `fcluster`），距离阈值从 `config.faces.distance_threshold` 读取
- 每个聚类 → `output/faces/person_{N}/`，将包含该人脸的图片复制进去
- 一张图中有多人时，复制到每个对应人物文件夹
- 未检测到人脸的图片 → `output/faces/unknown/`
- 聚类结果保存到 `output/faces/clusters.json`：

```json
{
  "person_1": ["file_id_a", "file_id_b"],
  "person_2": ["file_id_c"],
  "unknown": ["file_id_d"]
}
```

**完成标志：** faces 文件夹按人物分组正确。

---

## 10. 关键约束（贯穿所有步骤）

- **不自动删除原图**：所有操作基于 copy/symlink
- **容错优先**：单张图处理失败用 try/except 捕获，记录警告，继续下一张
- **所有阈值可配置**：硬编码的阈值都应从 config 读取
- **增量处理**：通过 SQLite 缓存层的 file_id 查重实现
- **编码规范**：类型注解，docstring 简洁（不重复函数名），代码精简
