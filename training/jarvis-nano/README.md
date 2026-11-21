# JARVIS-Nano, a new model trained from random initialization

This folder defines a genuinely new small language model for the JARVIS app. It does not download or fine-tune Qwen, Llama, Gemma, or another pretrained model. It trains a new byte-level BPE tokenizer and initializes a Llama-compatible decoder-only transformer with random weights.

## Model v0.1

- Name: JARVIS-Nano
- Architecture: 12 layers, hidden size 768, 12 attention heads, 2,048 intermediate size
- Vocabulary: 16,000 tokens by default
- Context: 1,024 tokens by default
- Initialization: random, no pretrained checkpoint
- Runtime target: GGUF through the app's llama.cpp JNI runtime
- Expected size: roughly 100M parameters; exact count is written to `model-card.json`

This is a starter model, not a claim of parity with Qwen/Llama/GPT. A small model trained from scratch needs a large, clean corpus and extensive evaluation. A tiny demo corpus will produce weak text generation.

## Train on a GPU runtime

Use a GPU machine such as a Colab T4. Upload a UTF-8 text corpus as `jarvis-corpus.jsonl`, one JSON object per line with a `text` field, or one plain text document per line.

```bash
pip install -r training/jarvis-nano/requirements.txt
python training/jarvis-nano/train_from_scratch.py \
  --data jarvis-corpus.jsonl \
  --output artifacts/jarvis-nano \
  --epochs 1 --batch-size 2 --gradient-accumulation 16
```

The script writes the tokenizer, Hugging Face checkpoint, and a model card. It intentionally refuses corpora that are too small to form even eight training blocks.

## Export for Android

After training, use the exact llama.cpp revision pinned in `frontend/android/app/src/main/cpp/CMakeLists.txt`:

```bash
python llama.cpp/convert_hf_to_gguf.py artifacts/jarvis-nano/hf \
  --outfile artifacts/jarvis-nano/jarvis-nano-f16.gguf --outtype f16
```

Then quantize on a build machine with llama.cpp's `llama-quantize`, for example:

```bash
llama-quantize artifacts/jarvis-nano/jarvis-nano-f16.gguf \
  artifacts/jarvis-nano/jarvis-nano-q4_k_m.gguf Q4_K_M
```

The quantized GGUF can be installed/imported by the Android app's local model manager once the model download and validation flow is connected to a published artifact.

## Data and evaluation rules

Only train on material you have permission to use. Remove personal data, credentials, private conversations, and copyrighted corpora without suitable rights. Keep a held-out evaluation set. Do not publish a checkpoint until loss, perplexity, refusal/safety behavior, multilingual behavior, and Android memory/performance have been evaluated.

## Current status

This is the reproducible training pipeline and architecture definition. It is **not** a trained or downloadable model checkpoint yet. The weights must be trained on a GPU using a sufficiently large licensed corpus, converted to GGUF, and tested on the target Android phone.
