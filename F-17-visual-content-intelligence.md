# F-17: Visual Content Intelligence
## Image Extraction · GPT-4o Vision (Low-Resolution Mode) · Image-Aware RAG · Student Image Gallery

> **Parent docs:** `college-chatbot-architecture.md` v2.0 · `F-13-book-intelligence-system.md` v1.0  
> **Problem:** The current ingestion pipeline extracts text from PDFs and PPTs but completely ignores all embedded images — diagrams, anatomical illustrations, flowcharts, graphs, ECG strips, histology slides, circuit diagrams, structural formulas. For medical and engineering students, these images ARE the content. A student asking "show me the brachial plexus diagram" gets nothing today.  
> **Solution:** During ingestion, extract every image from every page. Send each image to OpenAI GPT-4o Vision in **Low-Resolution mode** (170 tokens flat, ~$0.000255 per image) to generate: a rich text description, extracted labels/annotations, and a semantic caption. Store the description as a searchable vector chunk. Store the image file on local disk. When a student's query matches an image's description, surface the actual image inline in the chat response.  
> **OpenAI Vision model used:** `gpt-4o` with `detail: "low"` — fixed 512×512 downscale, fixed 170 token cost, no size penalty.  
> **Version:** 1.0 · May 2026

---

## Table of Contents

1. [Why Images Matter — The Medical & Engineering Case](#1-why-images-matter--the-medical--engineering-case)
2. [OpenAI Vision Low-Resolution Mode — Technical Constraints](#2-openai-vision-low-resolution-mode--technical-constraints)
3. [The Four-Layer Image Architecture](#3-the-four-layer-image-architecture)
4. [Database Schema — New Collections & Field Additions](#4-database-schema--new-collections--field-additions)
5. [F-17-A: Image Extraction from PDFs and PPTs](#5-f-17-a-image-extraction-from-pdfs-and-ppts)
6. [F-17-B: GPT-4o Vision Analysis (Low-Res Mode)](#6-f-17-b-gpt-4o-vision-analysis-low-res-mode)
7. [F-17-C: Image Vector Indexing](#7-f-17-c-image-vector-indexing)
8. [F-17-D: Image-Aware RAG Query Pipeline](#8-f-17-d-image-aware-rag-query-pipeline)
9. [F-17-E: Student UI — Image Display in Chat](#9-f-17-e-student-ui--image-display-in-chat)
10. [F-17-F: Image Gallery per Document](#10-f-17-f-image-gallery-per-document)
11. [F-17-G: Image-Specific Quiz Questions](#11-f-17-g-image-specific-quiz-questions)
12. [Cost Analysis & Filtering Strategy](#12-cost-analysis--filtering-strategy)
13. [API Route Map](#13-api-route-map)
14. [Frontend Component Tree](#14-frontend-component-tree)
15. [Python Worker Changes](#15-python-worker-changes)
16. [Updated Requirements & Environment Variables](#16-updated-requirements--environment-variables)
17. [Build Order — Phase 15](#17-build-order--phase-15)

---

## 1. Why Images Matter — The Medical & Engineering Case

### Medical textbooks — images are primary content

| Image type | Examples | Why it matters |
|---|---|---|
| Anatomical diagrams | Brachial plexus, heart cross-section, nephron structure | Students memorise these — the visual IS the knowledge |
| Histology slides | Liver cell, glomerulus, cardiac muscle | Microscopy images with labels that appear in exams |
| Pathology images | Infarct zones, tumour histology | Clinical diagnosis depends on visual pattern recognition |
| Flowcharts | Drug metabolism pathways, coagulation cascade | Connecting concepts students frequently get wrong |
| ECG strips | Sinus rhythm, STEMI pattern, arrhythmias | Direct clinical tool — must be seen not described |
| X-rays / CT scans | Pneumothorax, fracture patterns | Embedded in clinical case chapters |
| Drug structure | Molecular formulas, receptor diagrams | Pharmacology — structure determines function |

### Engineering textbooks — images are equally critical

| Image type | Examples | Why it matters |
|---|---|---|
| Circuit diagrams | Op-amp configurations, logic gates | Cannot understand without the diagram |
| Block diagrams | System architecture, signal flow | Core of control systems and embedded systems |
| Graphs & plots | Bode plots, stress-strain curves, V-I characteristics | Interpreting graphs is an exam skill |
| Algorithm flowcharts | Sorting, tree traversal, network protocols | Visual representation of logic |
| Machine drawings | Engineering tolerances, cross-sections | Mechanical engineering bread and butter |
| Chemical structures | Reaction mechanisms, stereochemistry | Organic chemistry cannot be done without these |

### The gap today

A student asks: **"Show me the structure of the nephron"**

Today's pipeline:
```
Query → embed("show me nephron structure") 
     → Pinecone search → text chunks only 
     → LLM: "The nephron consists of..."  ← generic text answer, no image
```

What should happen:
```
Query → embed("show me nephron structure")
     → Pinecone search → finds image chunk: "Detailed diagram of nephron structure
                          showing glomerulus, Bowman's capsule, proximal tubule,
                          loop of Henle, distal tubule, collecting duct.
                          Labels: PCT, LOH (descending/ascending), DCT, CD"
     → LLM: text explanation
     → Image: [nephron_diagram.png from Guyton Ch.27, Page 342] rendered inline
```

---

## 2. OpenAI Vision Low-Resolution Mode — Technical Constraints

### How GPT-4o Vision's detail levels work

OpenAI's vision API has two modes:

| Mode | How it works | Token cost | Use case |
|---|---|---|---|
| `"detail": "high"` | Tiles the image into 512×512 patches, processes each separately | 85 + 170 per tile (expensive) | Fine-grained reading of text, maps, dense diagrams |
| `"detail": "low"` | Downscales image to 512×512, processes as a single unit | **Fixed 170 tokens always** | Diagrams, charts, illustrations, anatomy figures |

**MediMind uses `detail: "low"` for all images.** Reasons:

1. **Fixed cost:** Every image costs exactly 170 tokens = $0.000255 at GPT-4o rates ($1.50/1M input tokens). No surprise bills from large images.
2. **Medical diagrams are perfectly suited:** Anatomical diagrams, flowcharts, circuit diagrams, and histology images all contain the key information at 512×512 resolution. The labels are readable. The spatial relationships are clear.
3. **Not for OCR:** We are NOT using vision for OCR (extracting typed text). That's handled by PyMuPDF and Tesseract. Vision is only for images — visual content that has no text equivalent.

### What low-res mode can and cannot do

**Can do well:**
- Describe what a diagram shows (nephron structure, circuit topology)
- Read label text on diagrams ("glomerulus", "Bowman's capsule")
- Describe the type of image (flowchart, anatomical cross-section, ECG)
- Identify colour-coding and what colours represent
- Extract axis labels from graphs
- Read annotation arrows and what they point to
- Describe spatial relationships ("the PCT connects to the loop of Henle below")

**Cannot do reliably:**
- Read very small body text within images (use PyMuPDF for that)
- Interpret complex dense text tables embedded as images
- Read handwritten text at low resolution
- Distinguish fine microscopy detail in low-quality scans

### Token budget calculation for a typical textbook

```
Guyton & Hall (1046 pages, ~3 images/page avg) = ~3,138 images
Filter: remove small images < 10,000 pixels = ~2,200 qualifying images
GPT-4o cost: 2,200 × 170 tokens × $1.50/1M tokens = $0.56 per book

Embedding the descriptions:
2,200 descriptions × avg 200 tokens × $0.00002/1K tokens = $0.009 per book

Total image processing cost per textbook: ~$0.57
```

This is negligible. A faculty member uploads Guyton once — the $0.57 is a one-time cost.

---

## 3. The Four-Layer Image Architecture

```
LAYER 1: EXTRACTION (Python worker — PyMuPDF)
  PDF/PPTX → extract all embedded images → save to local disk
  Filter: reject images < 10KB or < 100×100px (icons, bullets, logos)
  Output: image files at /storage/colleges/{cid}/images/{doc_id}/{page}_{idx}.jpg

LAYER 2: VISION ANALYSIS (Python worker — OpenAI GPT-4o, detail:low)
  For each extracted image:
    → Send base64 image to GPT-4o Vision API
    → Receive: structured JSON {description, labels, caption, image_type, clinical_relevance}
    → Store JSON in MongoDB image_assets collection
    → Write description as a "virtual text chunk" for embedding

LAYER 3: VECTOR INDEXING (Python worker — OpenAI text-embedding-3-small)
  For each image's GPT-4o description:
    → Embed the description text (NOT the image — text-embedding-3-small)
    → Upsert to same Pinecone namespace as text chunks
    → Metadata: chunk_type="image", image_asset_id, page_num, doc_id
    → The image is now searchable via natural language

LAYER 4: RETRIEVAL & DISPLAY (Fastify API + Student UI)
  Student query → Pinecone retrieves both text AND image chunks
  → Text chunks → LLM generates explanation
  → Image chunks → resolve image_asset_id → serve image file
  → Student sees: text answer + relevant diagram(s) inline
```

---

## 4. Database Schema — New Collections & Field Additions

### 4.1 New collection: `image_assets` (per-college DB)

```js
{
  _id: UUID,                             // image_asset_id

  // Source attribution
  doc_id: UUID,                          // which document this image came from
  college_id: UUID,
  dept_id: UUID,
  subject_id: UUID,

  // Location on disk
  file_path: String,                     // absolute local path to image file
                                         // /app/storage/colleges/{cid}/images/{doc_id}/{page}_{idx}.jpg
  thumbnail_path: String,                // smaller version for gallery view
                                         // /app/storage/colleges/{cid}/images/{doc_id}/thumb_{page}_{idx}.jpg
  file_size_bytes: Number,
  width_px: Number,
  height_px: Number,
  format: Enum["jpg", "png", "gif", "webp"],

  // Source location in the original document
  source_page: Number,                   // 1-indexed page number
  source_page_x: Number,                 // x position on page (for ordering)
  source_page_y: Number,                 // y position on page (for ordering)
  image_index_on_page: Number,           // 0-indexed: first image on page = 0
  global_image_index: Number,            // sequential across entire doc

  // GPT-4o Vision analysis results
  vision_status: Enum[
    "pending",                           // queued for analysis
    "processing",                        // being sent to GPT-4o
    "completed",                         // analysis done
    "failed",                            // GPT-4o error
    "skipped"                            // filtered out (too small, not useful)
  ],
  vision_model: String,                  // "gpt-4o"
  vision_detail: String,                 // "low"
  vision_tokens_used: Number,            // 170 for low-res

  // GPT-4o structured output
  description: String,                   // Full rich description of the image
                                         // "Detailed diagram of the nephron structure showing
                                         //  the glomerulus, Bowman's capsule, proximal convoluted
                                         //  tubule, loop of Henle (descending and ascending limbs),
                                         //  distal convoluted tubule, and collecting duct..."
  labels_extracted: [String],            // ["glomerulus", "Bowman's capsule", "PCT", "Loop of Henle"]
  caption: String,                       // Short 1-sentence caption: "Cross-section of the nephron"
  image_type: Enum[
    "anatomical_diagram",
    "histology",
    "pathology",
    "flowchart",
    "graph_chart",
    "circuit_diagram",
    "block_diagram",
    "chemical_structure",
    "clinical_image",     // X-ray, ECG, scan
    "photograph",
    "table_image",        // table embedded as image
    "equation",
    "other"
  ],
  clinical_relevance: String,            // "High — commonly tested in MBBS Physiology exams"
  alt_text: String,                      // Accessibility: concise description

  // Pinecone vector reference
  pinecone_vector_id: String,            // "{doc_id}_img_{image_asset_id}"
                                         // Same namespace as text chunks

  // Filtering metadata
  was_filtered: Boolean,                 // true if rejected (too small, etc.)
  filter_reason: String,                 // "too_small" | "logo_icon" | "low_quality"

  // Access control (for signed serving)
  access_token_prefix: String,           // for token-gated serving (F-11 pattern)

  created_at: Date,
  updated_at: Date
}

// Indexes
db.image_assets.createIndex({ doc_id: 1, source_page: 1 });
db.image_assets.createIndex({ doc_id: 1, vision_status: 1 });
db.image_assets.createIndex({ dept_id: 1, image_type: 1 });
db.image_assets.createIndex({ pinecone_vector_id: 1 });
```

### 4.2 Field additions to `documents` collection

```js
// Additions to existing documents schema
{
  // ... all existing fields ...

  // Image intelligence
  image_count_raw: Number,              // total images found in document (before filtering)
  image_count_analysed: Number,         // images successfully analysed by GPT-4o Vision
  image_count_indexed: Number,          // images with vectors in Pinecone
  image_ingestion_status: Enum[
    "not_started",                      // default — no image processing yet
    "queued",                           // in BullMQ queue
    "processing",                       // worker is running
    "completed",                        // all images analysed
    "partial",                          // some succeeded, some failed
    "failed"                            // critical failure
  ],
  image_ingestion_cost_usd: Number,     // total GPT-4o cost for this doc's images
  images_enabled: Boolean,              // admin can disable image analysis per doc
}
```

### 4.3 Pinecone vector metadata addition

Image description vectors live in the **same Pinecone namespace** as text chunks. They are distinguished by `chunk_type`:

```json
{
  "doc_id": "uuid",
  "dept_id": "uuid",
  "college_id": "uuid",
  "subject_id": "uuid",
  "filename": "Guyton_13th_Ed.pdf",
  "page": 342,
  "chunk_index": 0,
  "chunk_type": "image",
  "academic_year": "2025-26",
  "file_type": "pdf",

  "image_asset_id": "uuid",
  "image_type": "anatomical_diagram",
  "caption": "Cross-section of the nephron",
  "labels": "glomerulus,Bowman's capsule,PCT,Loop of Henle,DCT,collecting duct",
  "has_image_file": true
}
```

Text chunks have `chunk_type: "text"`. Image chunks have `chunk_type: "image"`. The RAG retrieval returns both types — the pipeline handles them differently.

---

## 5. F-17-A: Image Extraction from PDFs and PPTs

### 5.1 When image extraction runs

Image extraction is added as a separate step triggered AFTER the main text ingestion completes. It runs as a separate BullMQ job: `image_ingestion_job`.

```
Main ingestion (F-03 text pipeline) completes
  → Callback to Fastify: ingestion_status = "completed"
  → IF documents.images_enabled === true:
       → Fastify enqueues: image_ingestion_job { doc_id, file_path, ... }
  → document.image_ingestion_status = "queued"
```

This keeps image ingestion completely decoupled from text ingestion. Text search works immediately after text ingestion. Images are added progressively.

### 5.2 PDF image extraction (PyMuPDF)

```python
# services/ingestion-worker/jobs/extract_images.py

import fitz  # PyMuPDF
import os
from PIL import Image
import io

def extract_images_from_pdf(file_path: str, doc_id: str, college_id: str) -> list[dict]:
    """
    Extract all embedded images from a PDF.
    Returns list of image metadata dicts (before Vision analysis).
    """
    storage_root = os.environ["STORAGE_ROOT"]
    images_dir = os.path.join(storage_root, "colleges", college_id, "images", doc_id)
    os.makedirs(images_dir, exist_ok=True)

    pdf = fitz.open(file_path)
    extracted = []
    global_index = 0

    for page_num in range(len(pdf)):
        page = pdf[page_num]
        image_list = page.get_images(full=True)

        for img_idx, img_info in enumerate(image_list):
            xref = img_info[0]

            try:
                # Extract raw image bytes
                base_image = pdf.extract_image(xref)
                img_bytes = base_image["image"]
                img_ext = base_image["ext"]           # "jpeg", "png", etc.
                img_width = base_image["width"]
                img_height = base_image["height"]

                # ── Filter 1: Minimum size (reject icons, bullets, decorations)
                if img_width < 100 or img_height < 100:
                    extracted.append({
                        "was_filtered": True,
                        "filter_reason": "too_small",
                        "source_page": page_num + 1
                    })
                    continue

                # ── Filter 2: Minimum file size (reject 1-colour backgrounds)
                if len(img_bytes) < 10_000:           # < 10KB
                    extracted.append({
                        "was_filtered": True,
                        "filter_reason": "too_small",
                        "source_page": page_num + 1
                    })
                    continue

                # ── Filter 3: Aspect ratio sanity (reject line separators, headers)
                aspect_ratio = max(img_width, img_height) / min(img_width, img_height)
                if aspect_ratio > 15:                  # very narrow strip
                    extracted.append({
                        "was_filtered": True,
                        "filter_reason": "logo_icon",
                        "source_page": page_num + 1
                    })
                    continue

                # ── Save image to disk ──────────────────────────────────────
                filename = f"page{page_num+1:04d}_img{img_idx:02d}.jpg"
                file_path_out = os.path.join(images_dir, filename)

                # Convert to JPEG for consistency (normalises PNG, BMP, etc.)
                pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
                pil_img.save(file_path_out, "JPEG", quality=85)

                # ── Generate thumbnail (200px wide, maintain aspect ratio)
                thumb_path = os.path.join(images_dir, f"thumb_{filename}")
                thumb = pil_img.copy()
                thumb.thumbnail((200, 200), Image.LANCZOS)
                thumb.save(thumb_path, "JPEG", quality=75)

                # ── Get position on page for ordering ─────────────────────
                # PyMuPDF can give us the image rectangle on the page
                img_rect = page.get_image_rects(xref)
                x_pos = img_rect[0].x0 if img_rect else 0
                y_pos = img_rect[0].y0 if img_rect else 0

                extracted.append({
                    "was_filtered": False,
                    "file_path": file_path_out,
                    "thumbnail_path": thumb_path,
                    "file_size_bytes": os.path.getsize(file_path_out),
                    "width_px": pil_img.width,
                    "height_px": pil_img.height,
                    "format": "jpg",
                    "source_page": page_num + 1,
                    "source_page_x": x_pos,
                    "source_page_y": y_pos,
                    "image_index_on_page": img_idx,
                    "global_image_index": global_index,
                })
                global_index += 1

            except Exception as e:
                # Skip corrupted images silently
                print(f"  Skip image xref={xref} on page {page_num+1}: {e}")
                continue

    pdf.close()
    return extracted
```

### 5.3 PPTX image extraction (python-pptx)

```python
def extract_images_from_pptx(file_path: str, doc_id: str, college_id: str) -> list[dict]:
    """
    Extract all embedded images from a PPTX file.
    Each slide is treated as a "page".
    """
    from pptx import Presentation
    from pptx.util import Inches
    import pptx.oxml.ns as pptx_ns

    storage_root = os.environ["STORAGE_ROOT"]
    images_dir = os.path.join(storage_root, "colleges", college_id, "images", doc_id)
    os.makedirs(images_dir, exist_ok=True)

    prs = Presentation(file_path)
    extracted = []
    global_index = 0

    for slide_num, slide in enumerate(prs.slides):
        img_idx = 0
        for shape in slide.shapes:
            if shape.shape_type == 13:              # MSO_SHAPE_TYPE.PICTURE = 13
                try:
                    img_blob = shape.image.blob
                    img_ext = shape.image.ext       # "jpeg", "png"

                    if len(img_blob) < 10_000:
                        continue

                    filename = f"slide{slide_num+1:04d}_img{img_idx:02d}.jpg"
                    file_path_out = os.path.join(images_dir, filename)

                    pil_img = Image.open(io.BytesIO(img_blob)).convert("RGB")

                    if pil_img.width < 100 or pil_img.height < 100:
                        img_idx += 1
                        continue

                    pil_img.save(file_path_out, "JPEG", quality=85)

                    thumb_path = os.path.join(images_dir, f"thumb_{filename}")
                    thumb = pil_img.copy()
                    thumb.thumbnail((200, 200), Image.LANCZOS)
                    thumb.save(thumb_path, "JPEG", quality=75)

                    extracted.append({
                        "was_filtered": False,
                        "file_path": file_path_out,
                        "thumbnail_path": thumb_path,
                        "file_size_bytes": os.path.getsize(file_path_out),
                        "width_px": pil_img.width,
                        "height_px": pil_img.height,
                        "format": "jpg",
                        "source_page": slide_num + 1,    # slide number as "page"
                        "source_page_x": shape.left,
                        "source_page_y": shape.top,
                        "image_index_on_page": img_idx,
                        "global_image_index": global_index,
                    })
                    img_idx += 1
                    global_index += 1

                except Exception as e:
                    print(f"  Skip PPTX image slide={slide_num+1}: {e}")
                    continue

    return extracted
```

---

## 6. F-17-B: GPT-4o Vision Analysis (Low-Res Mode)

### 6.1 The vision analysis prompt

This is the most critical part of the feature. The prompt is designed to extract maximum semantic value from each image in the context of medical and engineering education.

```python
# services/ingestion-worker/jobs/analyse_image_vision.py

import base64
import json
from openai import OpenAI

VISION_SYSTEM_PROMPT = """You are an expert medical and engineering education content analyser.
You will be shown images extracted from academic textbooks and lecture materials.
Your task is to analyse each image and extract structured information that will help students
find and understand this image when they search for it.

Respond ONLY with a valid JSON object. No markdown, no preamble, no code fences.
Be precise, detailed, and use the exact technical terminology from the field."""

def build_vision_prompt(doc_filename: str, page_num: int, dept_name: str, subject_name: str) -> str:
    return f"""Analyse this image extracted from:
Document: {doc_filename}
Page: {page_num}
Subject: {subject_name} ({dept_name})

Return this exact JSON structure:
{{
  "description": "Detailed description of the image (3-5 sentences). 
                  Describe what is shown, the relationships between components, 
                  and the educational significance. Use precise technical terminology.",
  "labels_extracted": ["list", "of", "every", "label", "text", "visible", "in", "image"],
  "caption": "One concise sentence describing what this image shows (15 words max)",
  "image_type": "one of: anatomical_diagram | histology | pathology | flowchart | 
                 graph_chart | circuit_diagram | block_diagram | chemical_structure | 
                 clinical_image | photograph | table_image | equation | other",
  "clinical_relevance": "Brief note on when students encounter this in exams or clinical practice",
  "searchable_terms": ["list", "of", "10-20", "terms", "a", "student", "might", "search", "for",
                        "to", "find", "this", "image"],
  "alt_text": "Concise accessibility description (1-2 sentences)"
}}"""

async def analyse_image_with_vision(
    image_path: str,
    doc_filename: str,
    page_num: int,
    dept_name: str,
    subject_name: str
) -> dict:
    """
    Send image to GPT-4o Vision with detail:low and parse structured response.
    """
    client = OpenAI()

    # Read image and encode as base64
    with open(image_path, "rb") as f:
        image_data = base64.standard_b64encode(f.read()).decode("utf-8")

    # Determine MIME type
    ext = image_path.lower().split(".")[-1]
    mime_map = {"jpg": "image/jpeg", "jpeg": "image/jpeg",
                "png": "image/png", "gif": "image/gif", "webp": "image/webp"}
    mime_type = mime_map.get(ext, "image/jpeg")

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": VISION_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime_type};base64,{image_data}",
                                "detail": "low"          # ← FIXED: always low-res
                            }
                        },
                        {
                            "type": "text",
                            "text": build_vision_prompt(doc_filename, page_num, dept_name, subject_name)
                        }
                    ]
                }
            ],
            max_tokens=600,                              # description + labels + metadata
            temperature=0.1                              # low temperature for factual extraction
        )

        raw_text = response.choices[0].message.content.strip()
        # Strip accidental markdown fences if model adds them
        raw_text = raw_text.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(raw_text)

        # Add token usage for cost tracking
        parsed["tokens_used"] = response.usage.total_tokens
        parsed["model"] = "gpt-4o"
        parsed["detail"] = "low"

        return parsed

    except json.JSONDecodeError as e:
        # Vision returned non-JSON — create minimal fallback
        return {
            "description": f"Image on page {page_num} of {doc_filename}",
            "labels_extracted": [],
            "caption": f"Figure from page {page_num}",
            "image_type": "other",
            "clinical_relevance": "",
            "searchable_terms": [],
            "alt_text": f"Image from {doc_filename} page {page_num}",
            "tokens_used": 170,
            "model": "gpt-4o",
            "detail": "low",
            "parse_error": str(e)
        }

    except Exception as e:
        raise RuntimeError(f"Vision API error on {image_path}: {e}")
```

### 6.2 Batch processing with rate limit management

GPT-4o has rate limits. For a large textbook with 2,200 images, we process in batches with exponential backoff:

```python
import asyncio
import time

async def analyse_images_batch(
    image_records: list[dict],
    doc_filename: str,
    dept_name: str,
    subject_name: str,
    batch_size: int = 5,                    # process 5 images in parallel
    delay_between_batches: float = 1.0      # 1 second between batches
) -> list[dict]:
    """
    Process images in controlled batches to respect rate limits.
    """
    results = []

    for i in range(0, len(image_records), batch_size):
        batch = image_records[i:i + batch_size]

        # Process batch in parallel
        tasks = [
            analyse_image_with_vision(
                image_path=record["file_path"],
                doc_filename=doc_filename,
                page_num=record["source_page"],
                dept_name=dept_name,
                subject_name=subject_name
            )
            for record in batch
        ]

        batch_results = await asyncio.gather(*tasks, return_exceptions=True)

        for record, result in zip(batch, batch_results):
            if isinstance(result, Exception):
                # Mark as failed — don't crash entire pipeline
                results.append({
                    "image_record": record,
                    "vision_result": None,
                    "vision_status": "failed",
                    "error": str(result)
                })
            else:
                results.append({
                    "image_record": record,
                    "vision_result": result,
                    "vision_status": "completed"
                })

        # Respect rate limits
        if i + batch_size < len(image_records):
            await asyncio.sleep(delay_between_batches)

    return results
```

### 6.3 What the Vision output looks like in practice

**Input:** Nephron diagram from Guyton Chapter 27

**GPT-4o Vision response (low-res):**
```json
{
  "description": "A detailed anatomical diagram illustrating the structural organisation of the nephron, the functional unit of the kidney. The diagram shows the complete tubular system beginning with the glomerulus and Bowman's capsule, progressing through the proximal convoluted tubule (PCT), descending limb of the loop of Henle, ascending limb of the loop of Henle, the distal convoluted tubule (DCT), and terminating at the collecting duct. Arrows indicate the direction of filtrate flow, and coloured labelling differentiates the cortical and medullary segments.",
  "labels_extracted": ["Glomerulus", "Bowman's capsule", "PCT", "Proximal convoluted tubule", "Loop of Henle", "Descending limb", "Ascending limb", "DCT", "Distal convoluted tubule", "Collecting duct", "Cortex", "Medulla"],
  "caption": "Complete structure of the nephron showing all tubular segments",
  "image_type": "anatomical_diagram",
  "clinical_relevance": "Frequently tested in MBBS Physiology — essential for understanding renal handling of sodium, potassium, and water; basis for mechanism of diuretic drugs",
  "searchable_terms": ["nephron", "nephron structure", "kidney tubules", "glomerulus", "Bowman's capsule", "loop of Henle", "PCT", "DCT", "collecting duct", "renal tubule", "proximal tubule", "distal tubule", "kidney anatomy", "renal physiology"],
  "alt_text": "Anatomical diagram of the nephron showing its tubular structure from glomerulus to collecting duct with labeled components",
  "tokens_used": 170
}
```

---

## 7. F-17-C: Image Vector Indexing

### 7.1 Building the searchable text from Vision output

The embedding text combines all vision output fields into a rich, searchable string:

```python
def build_image_embedding_text(vision_result: dict, doc_filename: str, page_num: int,
                                subject_name: str) -> str:
    """
    Construct the text that will be embedded as the image's vector representation.
    More fields = richer semantic search coverage.
    """
    parts = [
        # Primary description
        vision_result.get("description", ""),

        # Searchable terms (boosts search recall significantly)
        "Keywords: " + ", ".join(vision_result.get("searchable_terms", [])),

        # Labels visible in the image
        "Labels: " + ", ".join(vision_result.get("labels_extracted", [])),

        # Caption
        vision_result.get("caption", ""),

        # Clinical/educational relevance
        vision_result.get("clinical_relevance", ""),

        # Contextual metadata
        f"From: {doc_filename}, page {page_num}, subject: {subject_name}",
        f"Image type: {vision_result.get('image_type', 'other')}"
    ]

    return "\n".join(p for p in parts if p.strip())
```

**Example embedding text for the nephron diagram:**
```
A detailed anatomical diagram illustrating the structural organisation of the nephron...
Keywords: nephron, nephron structure, kidney tubules, glomerulus, Bowman's capsule...
Labels: Glomerulus, Bowman's capsule, PCT, Proximal convoluted tubule, Loop of Henle...
Complete structure of the nephron showing all tubular segments
Frequently tested in MBBS Physiology — essential for understanding renal handling...
From: Guyton_13th_Ed.pdf, page 342, subject: Physiology
Image type: anatomical_diagram
```

This single text block is embedded with `text-embedding-3-small` → becomes the Pinecone vector.

### 7.2 Pinecone upsert for image vectors

```python
def upsert_image_vector(
    image_asset_id: str,
    doc_id: str,
    college_id: str,
    dept_id: str,
    subject_id: str,
    source_page: int,
    embedding: list[float],
    vision_result: dict,
    doc_filename: str,
    academic_year: str
):
    namespace = f"c_{college_id}_d_{dept_id}"
    vector_id = f"{doc_id}_img_{image_asset_id}"

    metadata = {
        # Standard chunk metadata (same as text chunks)
        "doc_id": doc_id,
        "dept_id": dept_id,
        "college_id": college_id,
        "subject_id": subject_id or "",
        "filename": doc_filename,
        "page": source_page,
        "academic_year": academic_year,
        "file_type": "pdf",                   # source file type

        # Image-specific metadata
        "chunk_type": "image",                # ← distinguishes from text chunks
        "image_asset_id": image_asset_id,
        "image_type": vision_result.get("image_type", "other"),
        "caption": vision_result.get("caption", "")[:200],   # Pinecone metadata 500 char limit
        "labels": ", ".join(vision_result.get("labels_extracted", []))[:300],
        "has_image_file": True,
        "alt_text": vision_result.get("alt_text", "")[:200],
    }

    pinecone_index.upsert(
        vectors=[(vector_id, embedding, metadata)],
        namespace=namespace
    )

    return vector_id
```

---

## 8. F-17-D: Image-Aware RAG Query Pipeline

### 8.1 What changes in the existing RAG pipeline

The existing pipeline (F-09) returns text chunks only. The image-aware version returns a mixed set of text and image chunks. The post-retrieval logic splits them and handles each appropriately.

```typescript
// services/api/src/services/rag.service.ts — updated version

async function queryWithImages(params: RAGParams): Promise<RAGResult> {
  const namespace = `c_${params.collegeId}_d_${params.effectiveDeptId}`;

  // 1. Embed the query (unchanged)
  const queryVector = await embedText(params.query);

  // 2. Retrieve mixed results (text + image chunks from same namespace)
  const retrieved = await pineconeIndex.query({
    vector: queryVector,
    namespace,
    filter: params.docId
      ? { doc_id: { $eq: params.docId } }           // chapter-scoped if in book study mode
      : { dept_id: { $eq: params.effectiveDeptId } }, // dept-scoped for general chat
    topK: 12,                                         // increased from 8 — need room for both types
    includeMetadata: true
  });

  // 3. Split results into text and image chunks
  const textChunks = retrieved.matches.filter(
    m => m.metadata.chunk_type !== "image" && m.score >= 0.60
  );
  const imageChunks = retrieved.matches.filter(
    m => m.metadata.chunk_type === "image" && m.score >= 0.65  // higher threshold for images
  );                                                             // (image descriptions are dense — avoid false positives)

  // 4. Rerank text chunks (Cohere) — images are not reranked (already semantically matched)
  const topTextChunks = textChunks.length > 0
    ? await cohereRerank(params.query, textChunks).then(r => r.slice(0, 5))
    : [];

  // 5. Select top 2–3 images (don't overwhelm the student with images)
  const topImageChunks = imageChunks.slice(0, 3);

  // 6. Resolve image assets from MongoDB (need file path for serving)
  const imageAssets = await Promise.all(
    topImageChunks.map(async chunk => {
      const asset = await imageAssetsCollection(params.collegeId).findOne({
        _id: chunk.metadata.image_asset_id
      });
      return asset ? { chunk, asset } : null;
    })
  ).then(results => results.filter(Boolean));

  // 7. Build text-only context for LLM (images are shown to user, not to LLM)
  const textContext = topTextChunks
    .map(c => `[Page ${c.metadata.page}] ${c.metadata.text}`)
    .join("\n\n");

  // Add image captions to context so LLM knows images are being shown
  const imageCaptionContext = imageAssets.length > 0
    ? "\n\nRelevant diagrams being shown to the student:\n" +
      imageAssets.map(ia =>
        `- ${ia.asset.caption} (Page ${ia.asset.source_page}, ${ia.asset.image_type})`
      ).join("\n")
    : "";

  // 8. Build system prompt (aware of images)
  const systemPrompt = buildImageAwareSystemPrompt(
    params.deptName,
    imageAssets.length > 0
  );

  // 9. Generate LLM response (text only — images are rendered by frontend)
  const llmResponse = await streamLLMResponse(
    systemPrompt,
    textContext + imageCaptionContext,
    params.query,
    params.conversationHistory,
    params
  );

  // 10. Generate signed access tokens for each image (F-11 pattern)
  const imageTokens = await Promise.all(
    imageAssets.map(async ia => {
      const token = await generateImageAccessToken(ia.asset, params.collegeId, params.deptId);
      return {
        image_asset_id: ia.asset._id,
        token_url: `/files/serve?token=${token}`,
        thumbnail_url: `/files/thumb?token=${await generateImageAccessToken(ia.asset, params.collegeId, params.deptId, 'thumbnail')}`,
        caption: ia.asset.caption,
        image_type: ia.asset.image_type,
        source_page: ia.asset.source_page,
        doc_filename: ia.asset.doc_filename,
        alt_text: ia.asset.alt_text,
        labels: ia.asset.labels_extracted,
        relevance_score: ia.chunk.score,
      };
    })
  );

  return {
    text_response: llmResponse,           // streamed via SSE
    images: imageTokens,                  // sent in "done" SSE event
    sources: {
      text: topTextChunks.map(c => ({
        page: c.metadata.page,
        filename: c.metadata.filename,
        score: c.score
      })),
      images: imageTokens.map(it => ({
        page: it.source_page,
        caption: it.caption,
        filename: it.doc_filename
      }))
    }
  };
}

function buildImageAwareSystemPrompt(deptName: string, hasImages: boolean): string {
  const base = `You are an academic assistant for the ${deptName} department.
Answer ONLY using the provided context. Always cite your source: "— [filename, Page X]".
If the answer is not in the context, say so clearly.`;

  if (hasImages) {
    return base + `\n\nImportant: Relevant diagrams are being shown to the student alongside your response.
Reference them naturally: "As shown in the diagram..." or "The figure illustrates...".
Do NOT describe the visual content of the image in detail — the student can see it.
Instead, use the image as context to give a richer explanation.`;
  }

  return base;
}
```

### 8.2 SSE event structure — images included in "done" event

```typescript
// Extended SSE event structure for image-aware responses

// Token events (unchanged — stream text as before)
data: { type: "token", content: "The nephron..." }
data: { type: "token", content: " is the functional unit..." }

// Done event — now includes images
data: {
  type: "done",
  answered: true,
  confidence_score: 0.87,
  tokens_used: 312,
  sources: {
    text: [
      { page: 342, filename: "Guyton_13th_Ed.pdf", score: 0.91 },
      { page: 338, filename: "Guyton_13th_Ed.pdf", score: 0.84 }
    ],
    images: [
      {
        image_asset_id: "uuid",
        token_url: "/files/serve?token=abc123",
        thumbnail_url: "/files/thumb?token=def456",
        caption: "Complete structure of the nephron showing all tubular segments",
        image_type: "anatomical_diagram",
        source_page: 342,
        doc_filename: "Guyton_13th_Ed.pdf",
        alt_text: "Anatomical diagram of the nephron...",
        labels: ["Glomerulus", "Bowman's capsule", "PCT", "Loop of Henle"],
        relevance_score: 0.89
      }
    ]
  }
}
```

---

## 9. F-17-E: Student UI — Image Display in Chat

### 9.1 Chat message with inline image

After the "done" SSE event arrives with image tokens, the `MessageBubble.tsx` component renders images inline below the text response:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 🧠 MediMind AI · Physiology · Guyton Chapter 27                         │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  You: Show me the structure of the nephron                               │
│                                                                          │
│  AI: The nephron is the functional unit of the kidney. As shown in       │
│  the diagram, it consists of a vascular component (glomerulus within     │
│  Bowman's capsule) and a tubular component (PCT → Loop of Henle →       │
│  DCT → Collecting Duct). The proximal convoluted tubule reabsorbs        │
│  ~65% of filtered sodium and water. — Guyton Ch.27, Page 342           │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │                [Nephron diagram image]                         │     │
│  │                                                                │     │
│  │  Caption: Complete structure of the nephron showing all        │     │
│  │  tubular segments                                              │     │
│  │                                                                │     │
│  │  🏷 Glomerulus · Bowman's capsule · PCT · Loop of Henle       │     │
│  │     DCT · Collecting duct                                      │     │
│  │                                                                │     │
│  │  📖 Guyton 13th Ed · Page 342 · Anatomical diagram            │     │
│  │                                                                │     │
│  │  [🔍 View full size]  [📌 Add to notes]  [⬇ Download]        │     │
│  └────────────────────────────────────────────────────────────────┘     │
│                                                                          │
│  [📌 Save response]  [🔄 Regenerate]                                    │
└──────────────────────────────────────────────────────────────────────────┘
```

### 9.2 `InlineChatImage.tsx` component

```tsx
// apps/student/components/chat/InlineChatImage.tsx

interface ChatImageProps {
  imageAsset: {
    image_asset_id: string;
    token_url: string;
    thumbnail_url: string;
    caption: string;
    image_type: string;
    source_page: number;
    doc_filename: string;
    alt_text: string;
    labels: string[];
    relevance_score: number;
  };
  onAddToNotes: (imageAssetId: string) => void;
}

export function InlineChatImage({ imageAsset, onAddToNotes }: ChatImageProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Image type badge colour mapping
  const typeColors: Record<string, string> = {
    anatomical_diagram: "bg-blue-100 text-blue-700",
    histology: "bg-purple-100 text-purple-700",
    flowchart: "bg-green-100 text-green-700",
    circuit_diagram: "bg-orange-100 text-orange-700",
    graph_chart: "bg-teal-100 text-teal-700",
    clinical_image: "bg-red-100 text-red-700",
    chemical_structure: "bg-yellow-100 text-yellow-700",
  };

  const typeBadgeClass = typeColors[imageAsset.image_type] || "bg-slate-100 text-slate-600";

  return (
    <div className="mt-3 border border-slate-700/50 rounded-xl overflow-hidden bg-slate-800/30">
      {/* Image */}
      <div
        className="relative cursor-pointer group"
        onClick={() => setIsExpanded(true)}
      >
        {!imageLoaded && !imageError && (
          <div className="h-48 bg-slate-700/50 animate-pulse flex items-center justify-center">
            <span className="text-slate-500 text-sm">Loading image...</span>
          </div>
        )}
        {imageError && (
          <div className="h-48 bg-slate-700/50 flex items-center justify-center">
            <span className="text-slate-500 text-sm">Image unavailable</span>
          </div>
        )}
        <img
          src={imageAsset.token_url}
          alt={imageAsset.alt_text}
          className={`w-full max-h-80 object-contain bg-white ${imageLoaded ? 'block' : 'hidden'}`}
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageError(true)}
        />
        {/* Expand overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all flex items-center justify-center">
          <span className="opacity-0 group-hover:opacity-100 bg-black/60 text-white text-xs px-3 py-1 rounded-full">
            Click to expand
          </span>
        </div>
      </div>

      {/* Caption and metadata */}
      <div className="p-3">
        <p className="text-sm font-medium text-slate-200 mb-2">{imageAsset.caption}</p>

        {/* Labels */}
        {imageAsset.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            <span className="text-xs text-slate-500">🏷</span>
            {imageAsset.labels.slice(0, 8).map(label => (
              <span key={label} className="text-xs bg-slate-700/50 text-slate-400 px-2 py-0.5 rounded">
                {label}
              </span>
            ))}
            {imageAsset.labels.length > 8 && (
              <span className="text-xs text-slate-500">+{imageAsset.labels.length - 8} more</span>
            )}
          </div>
        )}

        {/* Source + type */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              📖 {imageAsset.doc_filename} · Page {imageAsset.source_page}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded ${typeBadgeClass}`}>
              {imageAsset.image_type.replace(/_/g, " ")}
            </span>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={() => setIsExpanded(true)}
              className="text-xs text-teal-400 hover:text-teal-300"
              title="View full size"
            >
              🔍 Full size
            </button>
            <button
              onClick={() => onAddToNotes(imageAsset.image_asset_id)}
              className="text-xs text-teal-400 hover:text-teal-300"
              title="Add to study notes"
            >
              📌 Notes
            </button>
            <a
              href={imageAsset.token_url}
              download
              className="text-xs text-teal-400 hover:text-teal-300"
              title="Download image"
            >
              ⬇ Save
            </a>
          </div>
        </div>
      </div>

      {/* Lightbox for full-size view */}
      {isExpanded && (
        <ImageLightbox
          src={imageAsset.token_url}
          alt={imageAsset.alt_text}
          caption={imageAsset.caption}
          labels={imageAsset.labels}
          onClose={() => setIsExpanded(false)}
        />
      )}
    </div>
  );
}
```

### 9.3 `ImageLightbox.tsx` — full-screen image viewer

```tsx
// apps/student/components/chat/ImageLightbox.tsx

export function ImageLightbox({ src, alt, caption, labels, onClose }) {
  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="max-w-5xl max-h-full flex flex-col gap-3"
        onClick={e => e.stopPropagation()}
      >
        {/* Image — full resolution */}
        <img
          src={src}
          alt={alt}
          className="max-h-[80vh] object-contain rounded-lg"
        />

        {/* Caption */}
        <div className="bg-black/60 rounded-lg p-3 text-center">
          <p className="text-white text-sm font-medium">{caption}</p>
          {labels.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1 mt-2">
              {labels.map(l => (
                <span key={l} className="text-xs bg-white/10 text-white/80 px-2 py-0.5 rounded">
                  {l}
                </span>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="text-white/60 hover:text-white text-sm text-center"
        >
          ✕ Close (Esc)
        </button>
      </div>
    </div>
  );
}
```

---

## 10. F-17-F: Image Gallery per Document

### 10.1 Image gallery tab in the Document Viewer

The Document Viewer (F-11-B) gets a new **Images** tab alongside Chat, Read, and Summary:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 📖 Guyton 13th Ed.pdf              [Chat] [Read] [Summary] [Images 48]  │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Filter: [All types ▼]  [All pages ▼]  [Search labels/captions...]     │
│                                                                          │
│  Page 1–50                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
│  │ [IMG Pg.3]   │  │ [IMG Pg.12]  │  │ [IMG Pg.18]  │                 │
│  │ Heart         │  │ Cardiac cycle│  │ ECG strip     │                 │
│  │ cross-section │  │ flowchart    │  │ PQRST waves   │                 │
│  │ anatomical    │  │ flowchart    │  │ clinical_img  │                 │
│  └──────────────┘  └──────────────┘  └──────────────┘                 │
│                                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
│  │ [IMG Pg.29]  │  │ [IMG Pg.34]  │  │ [IMG Pg.41]  │                 │
│  │ Nephron       │  │ Juxtaglom.   │  │ Countercurr.  │                 │
│  │ structure     │  │ apparatus    │  │ mechanism     │                 │
│  │ anatomical    │  │ anatomical   │  │ diagram       │                 │
│  └──────────────┘  └──────────────┘  └──────────────┘                 │
│                                                                          │
│  Page 51–100 ▼                                                          │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 10.2 Image gallery API

```
GET /api/v1/college/:cid/student/library/:docId/images
    ?page=1&limit=24
    &image_type=anatomical_diagram|histology|flowchart|...
    &source_page_from=1&source_page_to=50
    &q=nephron               ← search within labels/captions/description

Response: {
  images: [ImageGalleryItem],
  total: 48,
  by_type: { anatomical_diagram: 18, flowchart: 12, graph_chart: 8, ... },
  pagination: { page: 1, limit: 24, total_pages: 2 }
}
```

---

## 11. F-17-G: Image-Specific Quiz Questions

### 11.1 Image labelling quiz (new question type)

The quiz engine (F-13-D) gets a new question type: `IMAGE_LABEL` — the student is shown an image with labels hidden and must identify the structure being pointed to.

**Quiz question generation using the image asset:**

```python
async def generate_image_labelling_question(image_asset: dict, doc_filename: str) -> dict:
    """
    Generate a label-identification question from an image.
    The actual image is shown; student must name the structure.
    """
    # Use the labels extracted by Vision
    if len(image_asset["labels_extracted"]) < 3:
        return None     # not enough labels for a meaningful question

    import random
    target_label = random.choice(image_asset["labels_extracted"])

    return {
        "question_text": f"In the diagram shown, what structure is indicated by the arrow?",
        "question_type": "IMAGE_LABEL",
        "image_asset_id": image_asset["_id"],
        "image_token_url": None,               # resolved at serve time
        "correct_answer": target_label,
        "options": random.sample(image_asset["labels_extracted"], min(4, len(image_asset["labels_extracted"]))),
        "explanation": f"This is the {target_label}. {image_asset['description'][:200]}",
        "source_page": image_asset["source_page"],
        "bloom_level": "remember"
    }
```

**UI for image labelling question:**
```
┌──────────────────────────────────────────────────────────────────────────┐
│ Quiz · Ch 27: The Kidney     Question 6 of 10        [⏱ 1:24]          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  [Nephron diagram image — labels visible but one is highlighted with 🔴]│
│                                                                          │
│  What structure is indicated by the red arrow?                           │
│                                                                          │
│  ○ A) Glomerulus                                                        │
│  ● B) Bowman's capsule               ← selected                        │
│  ○ C) Proximal convoluted tubule                                        │
│  ○ D) Loop of Henle                                                     │
│                                                                          │
│                    [Submit Answer]                                       │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 12. Cost Analysis & Filtering Strategy

### 12.1 Per-book cost breakdown

```
Typical medical textbook (1,000 pages, ~3 images/page):
  Raw images extracted:           3,000
  After size filter (< 100×100): -400   (icons, bullets, ornaments)
  After file size filter (< 10KB):-200   (background fills, lines)
  After aspect ratio filter:      -150   (separators, headers)
  Qualifying images for Vision:   2,250

GPT-4o Vision (low-res, $1.50/1M input tokens):
  2,250 images × 170 tokens = 382,500 tokens = $0.57

OpenAI embeddings for descriptions (text-embedding-3-small):
  2,250 descriptions × avg 200 tokens = 450,000 tokens
  $0.00002/1K × 450K = $0.009

Pinecone storage for image vectors (2,250 additional vectors):
  Negligible — 2,250 / 1,000,000 × $0.35 = < $0.001

Total per medical textbook:  ~$0.58 one-time cost
Total per engineering textbook (500 pages, 2 images/page avg):
  ~1,000 qualifying images × $0.57/2,250 = ~$0.25 one-time cost
```

### 12.2 Admin control — enable/disable per document

The Dept Admin upload panel gets an `Enable Image Analysis` toggle:

```
[ ✓ ] Enable image analysis   ($0.28 estimated — 980 images detected)
      Images will be extracted and made searchable.
      Disable for documents that are text-only or for cost savings.
```

The cost estimate is shown BEFORE confirmation so the admin makes an informed decision. For text-only documents (notes, question papers, word docs), image analysis is disabled by default.

### 12.3 Filtering logic — what gets rejected

```python
def should_analyse_image(img_bytes: bytes, width: int, height: int) -> tuple[bool, str]:
    """
    Returns (should_analyse, rejection_reason).
    """
    # Too small (icons, bullets, decorative elements)
    if width < 100 or height < 100:
        return False, "too_small"

    # Too little data (solid colour fills, line separators)
    if len(img_bytes) < 10_000:
        return False, "too_small"

    # Extreme aspect ratio (headers, footers, dividers)
    if width > 0 and height > 0:
        ratio = max(width, height) / min(width, height)
        if ratio > 15:
            return False, "logo_icon"

    # Likely a repeated decoration (very common in PDF templates)
    # Check if this exact image hash was seen before in this doc
    # (deduplication — same image on multiple pages only analysed once)
    # Implemented with an in-memory set during ingestion

    return True, None
```

### 12.4 Image deduplication (save cost on repeated images)

Many textbooks repeat the same figure across multiple pages (headers, watermarks, repeated diagrams). We deduplicate by image content hash:

```python
import hashlib

# During extraction — track hashes seen
seen_hashes: set[str] = set()

def get_image_hash(img_bytes: bytes) -> str:
    return hashlib.md5(img_bytes).hexdigest()

# In extraction loop:
img_hash = get_image_hash(img_bytes)
if img_hash in seen_hashes:
    # Skip Vision analysis — reuse existing analysis
    # Just create a new image_asset record pointing to existing analysis
    existing_asset = await find_asset_by_hash(img_hash, doc_id, college_id)
    if existing_asset:
        # Create new asset record linking to same file + same Vision result
        # but different source_page
        continue    # don't re-send to GPT-4o

seen_hashes.add(img_hash)
```

This reduces Vision API calls by an estimated 15–25% for typical textbooks.

---

## 13. API Route Map

```
# Image gallery — student access
GET    /api/v1/college/:cid/student/library/:docId/images
       ?page=1&limit=24&image_type=&source_page_from=&source_page_to=&q=
       Response: { images[], total, by_type }

GET    /api/v1/college/:cid/student/library/:docId/images/:imageAssetId
       Response: ImageAsset full detail

# Image file serving (same pattern as F-11-C token-gated serving)
GET    /api/v1/college/:cid/student/images/:imageAssetId/access-token
       ?intent=view|download|thumbnail
       Response: { token_url, expires_at, caption, alt_text }

GET    /files/serve?token=<uuid>
       (existing route — serves image files same as document files)

GET    /files/thumb?token=<uuid>
       (new route — serves thumbnail version of image)

# Image search
POST   /api/v1/college/:cid/student/images/search
       Body: { query: "nephron diagram", doc_id?: "uuid", chapter_idx?: 3 }
       Response: { images[], text_context }
       (dedicated semantic image search — separate from chat)

# Admin — image ingestion control
GET    /api/v1/college/:cid/admin/documents/:docId/images
       Response: { images[], total, vision_status_summary }

POST   /api/v1/college/:cid/admin/documents/:docId/images/trigger
       Body: { enabled: true }
       (trigger or re-trigger image analysis for a document)

GET    /api/v1/college/:cid/admin/documents/:docId/images/:imageAssetId
       Response: ImageAsset with vision output detail

PATCH  /api/v1/college/:cid/admin/documents/:docId/images/:imageAssetId/hide
       (admin can hide specific images from student view)

# Cost tracking (extends F-12)
GET    /api/v1/super-admin/analytics/image-ingestion-costs?month=2026-05
       Response: { by_college[], total_images, total_cost_usd }
```

---

## 14. Frontend Component Tree

```
apps/student/components/
├── chat/
│   ├── InlineChatImage.tsx              # Image rendered below AI text response
│   ├── ImageLightbox.tsx                # Full-screen image viewer
│   └── ImageLabels.tsx                  # Label chips display
├── library/
│   ├── ImageGalleryTab.tsx              # Gallery tab in document viewer
│   ├── ImageGalleryGrid.tsx             # Masonry/grid of image thumbnails
│   ├── ImageGalleryCard.tsx             # Single image card with caption + type badge
│   └── ImageTypeFilter.tsx              # Filter by anatomical/flowchart/etc.
└── quiz/
    └── ImageLabelQuestion.tsx           # New quiz question type with image display

apps/student/hooks/
├── useChatWithImages.ts                 # Extended chat hook — handles image tokens in SSE
├── useImageGallery.ts                   # tRPC query for document image gallery
└── useImageSearch.ts                    # Semantic image search

apps/admin/components/dept-admin/
├── DocumentImageStatus.tsx              # Shows image ingestion progress + cost
└── ImageAnalysisToggle.tsx              # Enable/disable image analysis per doc

apps/admin/components/college-admin/
└── ImageCostSummary.tsx                 # Cross-dept image ingestion cost overview
```

---

## 15. Python Worker Changes

### 15.1 New job type: `image_ingestion`

```python
# services/ingestion-worker/worker.py — additions
JOB_HANDLERS = {
    # ... existing handlers ...
    "image_ingestion": handle_image_ingestion,   # F-17
}
```

### 15.2 Main image ingestion job handler

```python
# services/ingestion-worker/jobs/image_ingestion.py

async def handle_image_ingestion(job_data: dict):
    doc_id      = job_data["doc_id"]
    file_path   = job_data["file_path"]
    file_type   = job_data["file_type"]
    college_id  = job_data["college_id"]
    dept_id     = job_data["dept_id"]
    subject_id  = job_data.get("subject_id")
    doc_filename = job_data["doc_filename"]
    dept_name   = job_data["dept_name"]
    subject_name = job_data.get("subject_name", "")
    academic_year = job_data["academic_year"]

    # Update status
    await update_document(college_id, doc_id, {"image_ingestion_status": "processing"})

    try:
        # Step 1: Extract images from file
        if file_type == "pdf":
            raw_images = extract_images_from_pdf(file_path, doc_id, college_id)
        elif file_type == "pptx":
            raw_images = extract_images_from_pptx(file_path, doc_id, college_id)
        else:
            # DOCX, MP4, etc. — no image extraction
            await update_document(college_id, doc_id, {
                "image_ingestion_status": "completed",
                "image_count_raw": 0,
                "image_count_analysed": 0,
                "image_count_indexed": 0,
                "image_ingestion_cost_usd": 0.0
            })
            return

        # Step 2: Separate filtered from qualifying
        qualifying = [img for img in raw_images if not img.get("was_filtered")]
        filtered   = [img for img in raw_images if img.get("was_filtered")]

        await update_document(college_id, doc_id, {"image_count_raw": len(raw_images)})

        if not qualifying:
            await update_document(college_id, doc_id, {
                "image_ingestion_status": "completed",
                "image_count_analysed": 0,
                "image_count_indexed": 0,
                "image_ingestion_cost_usd": 0.0
            })
            return

        # Step 3: Save filtered images as skipped records
        for img in filtered:
            await save_image_asset_skipped(college_id, doc_id, dept_id, img)

        # Step 4: GPT-4o Vision analysis in batches
        vision_results = await analyse_images_batch(
            qualifying, doc_filename, dept_name, subject_name
        )

        # Step 5: Embed + upsert to Pinecone, save to MongoDB
        total_cost = 0.0
        indexed_count = 0
        image_asset_ids = []

        client = OpenAI()
        embedding_texts = []
        for result in vision_results:
            if result["vision_status"] != "completed":
                continue
            text = build_image_embedding_text(
                result["vision_result"], doc_filename,
                result["image_record"]["source_page"], subject_name
            )
            embedding_texts.append(text)

        # Batch embed all descriptions at once (cheaper)
        if embedding_texts:
            embedding_response = client.embeddings.create(
                model="text-embedding-3-small",
                input=embedding_texts
            )

            for i, (result, embedding) in enumerate(
                zip([r for r in vision_results if r["vision_status"] == "completed"],
                    embedding_response.data)
            ):
                image_asset_id = generate_uuid()
                cost = result["vision_result"]["tokens_used"] * 1.50 / 1_000_000

                # Save image_asset to MongoDB
                await save_image_asset(
                    college_id, doc_id, dept_id, subject_id,
                    result["image_record"], result["vision_result"],
                    image_asset_id
                )

                # Upsert vector to Pinecone
                vector_id = upsert_image_vector(
                    image_asset_id, doc_id, college_id, dept_id, subject_id,
                    result["image_record"]["source_page"],
                    embedding.embedding,
                    result["vision_result"],
                    doc_filename, academic_year
                )

                # Update image_asset with vector ID
                await update_image_asset(college_id, image_asset_id, {
                    "pinecone_vector_id": vector_id,
                    "vision_status": "completed"
                })

                total_cost += cost
                indexed_count += 1
                image_asset_ids.append(image_asset_id)

        # Step 6: Final update
        await update_document(college_id, doc_id, {
            "image_ingestion_status": "completed",
            "image_count_analysed": indexed_count,
            "image_count_indexed": indexed_count,
            "image_ingestion_cost_usd": round(total_cost, 6)
        })

        # Step 7: Log cost event to platform DB
        await log_cost_event(college_id, dept_id, "image_ingestion", "openai_vision",
                             tokens_used=indexed_count * 170,
                             cost_usd=total_cost)

    except Exception as e:
        await update_document(college_id, doc_id, {
            "image_ingestion_status": "failed",
            "image_ingestion_error": str(e)
        })
        raise
```

---

## 16. Updated Requirements & Environment Variables

### 16.1 New Python dependencies

```
# Additions to services/ingestion-worker/requirements.txt

Pillow==10.3.0            # Image processing (convert, resize, thumbnail)
# PyMuPDF already present — handles image extraction
# python-pptx already present — handles PPTX image extraction
# openai already present — add Vision API calls (same client, same key)
```

### 16.2 New environment variables

```bash
# Addition to services/ingestion-worker/.env

# OpenAI Vision (uses same OPENAI_API_KEY as embeddings)
VISION_MODEL=gpt-4o
VISION_DETAIL=low
VISION_MAX_TOKENS=600
VISION_TEMPERATURE=0.1
VISION_BATCH_SIZE=5                  # images processed in parallel
VISION_BATCH_DELAY_SEC=1.0           # delay between batches (rate limit)
VISION_RATE_LIMIT_RPM=100            # GPT-4o default tier

# Image filtering thresholds
IMAGE_MIN_WIDTH_PX=100
IMAGE_MIN_HEIGHT_PX=100
IMAGE_MIN_SIZE_BYTES=10000           # 10KB minimum
IMAGE_MAX_ASPECT_RATIO=15            # reject very narrow/wide strips

# Image storage
IMAGE_JPEG_QUALITY=85
IMAGE_THUMBNAIL_SIZE=200             # max dimension for thumbnails
IMAGE_THUMBNAIL_QUALITY=75

# Cost limits
IMAGE_INGESTION_MAX_COST_PER_DOC_USD=5.00   # hard stop if doc has 10,000+ images
IMAGE_INGESTION_DEFAULT_ENABLED=true         # whether to auto-enable on upload

# Addition to services/api/.env

# Image serving token TTLs
IMAGE_ACCESS_TOKEN_TTL=3600          # 1 hour for full image
IMAGE_THUMBNAIL_TOKEN_TTL=7200       # 2 hours for thumbnails (loaded in gallery)
```

---

## 17. Build Order — Phase 15

```
Phase 15 — Visual Content Intelligence

Step 1 — Schema setup
  → Create image_assets collection + all indexes (per-college DB)
  → Add fields to documents: image_count_raw, image_count_analysed,
    image_count_indexed, image_ingestion_status, image_ingestion_cost_usd, images_enabled
  → Add cost_events support: "image_ingestion" action_type, "openai_vision" service
  → Update rate_table: add openai_vision pricing (gpt-4o low-res = $1.50/1M input)
  → Update Pinecone metadata: chunk_type field (backfill existing vectors with chunk_type:"text")

Step 2 — Image extraction functions (Python worker)
  → extract_images_from_pdf() using PyMuPDF
  → extract_images_from_pptx() using python-pptx
  → should_analyse_image() filter function
  → get_image_hash() deduplication utility
  → generate thumbnail function
  → Unit test: extract from Guyton sample PDF → verify filtering counts

Step 3 — GPT-4o Vision integration (Python worker)
  → analyse_image_with_vision() with structured JSON prompt
  → build_vision_prompt() (subject-aware prompt builder)
  → analyse_images_batch() with rate limit management
  → build_image_embedding_text() — combines all Vision fields
  → Unit test: send one medical diagram → verify description quality + JSON parse

Step 4 — Pinecone image vector indexing (Python worker)
  → upsert_image_vector() with chunk_type:"image" metadata
  → save_image_asset() to MongoDB
  → handle_image_ingestion() — full job handler
  → Register "image_ingestion" in worker.py job handlers
  → End-to-end test: upload Guyton PDF → trigger image ingestion →
    verify image_assets populated + vectors in Pinecone

Step 5 — RAG pipeline update (Fastify API)
  → Update queryPipeline() to split text/image chunks
  → Add imageChunks → image_assets lookup
  → Add generateImageAccessToken() for each retrieved image
  → Update SSE "done" event: include images[] array
  → Update system prompt: image-aware variant
  → Test: query "show me the nephron structure" → verify image returned in "done" event

Step 6 — Image file serving (Fastify API)
  → GET /files/thumb?token= route (thumbnail serving, uses existing /files/serve pattern)
  → GET /student/images/:imageAssetId/access-token?intent=view|download|thumbnail
  → Update Redis token storage: support thumbnail_path separately from file_path

Step 7 — Image gallery API (Fastify API)
  → GET /student/library/:docId/images (with filters)
  → GET /student/images/search (semantic image search)
  → GET /admin/documents/:docId/images (admin view)
  → POST /admin/documents/:docId/images/trigger (manual trigger)
  → PATCH /admin/documents/:docId/images/:imageAssetId/hide

Step 8 — Student UI: Chat inline images
  → InlineChatImage.tsx — renders image below AI text response
  → ImageLightbox.tsx — full-screen viewer with labels
  → Update MessageBubble.tsx: render InlineChatImage for each image in "done" event
  → Update useChatWithImages.ts hook: parse images[] from SSE done event
  → Test: end-to-end chat → image appears inline below response

Step 9 — Student UI: Image Gallery
  → ImageGalleryTab.tsx (new tab in document viewer)
  → ImageGalleryGrid.tsx + ImageGalleryCard.tsx
  → ImageTypeFilter.tsx
  → Test: open Guyton in library → Images tab shows 48 images in grid

Step 10 — Admin UI: Image ingestion controls
  → DocumentImageStatus.tsx (shows progress + cost in admin document list)
  → ImageAnalysisToggle.tsx (enable/disable per document on upload form)
  → Update document upload flow: show image analysis option + cost estimate

Step 11 — Quiz: Image labelling questions
  → generate_image_labelling_question() in Python quiz generator
  → ImageLabelQuestion.tsx React component
  → Update quiz session to support IMAGE_LABEL question type

Step 12 — Cost tracking (extend F-12)
  → Add openai_vision service to cost_events metering
  → image_ingestion_cost_usd tracked per document
  → Super Admin dashboard: image ingestion costs visible in college breakdown

Step 13 — Testing checklist
  → Upload text-only PDF → verify image_count_raw = 0, image_ingestion_status skips gracefully
  → Upload Guyton (1046p) → verify ~2,200 images extracted, ~350 filtered, ~1,850 analysed
  → Verify thumbnail files created at correct paths
  → Vision test: check 5 image descriptions for medical accuracy
  → Pinecone: verify image vectors have chunk_type:"image" metadata
  → RAG test: "show me the brachial plexus" → verify image returned (not just text)
  → RAG test: "explain cardiac output" → text-only query → verify no irrelevant images returned
  → Gallery: open document → Images tab → filter by "flowchart" → verify correct images shown
  → Lightbox: click image → verify full-size opens → Esc closes
  → Cost: check image_ingestion_cost_usd in document record matches expected ~$0.57/book
  → Deduplication: upload document with repeated header image → verify Vision called once not 10×
  → Admin hide: hide an image → verify it no longer appears in student gallery or chat
```

---

*Document: F-17-visual-content-intelligence.md · v1.0 · May 2026*  
*Extends: college-chatbot-architecture.md v2.0 · F-13-book-intelligence-system.md v1.0 · F-11-student-document-library.md v1.1*  
*OpenAI model: gpt-4o with detail:"low" — fixed 170 token cost per image regardless of image size*  
*Key constraint: images are NEVER sent to the LLM for response generation. Vision extracts a text description during ingestion; only that text is sent at query time. The image file is served separately to the student UI.*  
*For Claude Code: Phase 15, 13 steps. Start with Steps 1–3 (schema + extraction + Vision) — you can test the full ingestion pipeline before touching the RAG pipeline or UI.*
