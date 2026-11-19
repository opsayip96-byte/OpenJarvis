# JARVIS private model lab

This directory is for building a private JARVIS assistant model and, later, a separate foundation-model research project. It is not a publishing workflow.

## Two complementary learning paths

### A. Immediate instruction and memory learning

When Teach JARVIS is enabled on Android, the user-authored instruction is saved locally and injected into subsequent local-model prompts. This changes the context JARVIS sees, not its neural-network weights. The instruction list can be reviewed and deleted in Settings.

### B. Actual model-weight learning

The app stores the model's answer as an untrusted suggestion. It is not a training label. In Settings, the user must edit or replace the target answer and explicitly approve that example. Only approved prompt/target-answer pairs are included in the JSONL export.

Exported training data remains on the device until the user explicitly exports it. Review and sanitize the exported file before training. Never ingest passwords, API keys, private messages, financial credentials, medical data or other sensitive information.

## Track 1: private JARVIS model

1. Choose and pin an openly licensed base model and exact revision.
2. Download and verify the weights and tokenizer on a development machine.
3. Export approved examples from JARVIS and inspect the JSONL manually.
4. Deduplicate and split examples into train and validation sets. Keep a separate capability test set out of training.
5. Establish base-model scores before fine-tuning.
6. Train a LoRA/PEFT adapter with a reproducible config and fixed seed.
7. Compare adapter vs base on held-out tests, including tool argument validity and false capability claims.
8. Export/merge the adapter only if it improves target tasks without unacceptable regressions.
9. Convert to a supported local inference format, verify hashes, then test on the target Android device.

Example command from the repository root:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r training/requirements.txt
python training/train_lora.py --train path/to/jarvis-approved-training.jsonl --output training/output/jarvis-lora
```

A one-time training machine with suitable GPU memory is required for practical fine-tuning. This script runs locally and does not upload data or call a hosted inference API. After packaging, inference can run locally on the phone. A GGUF file is an inference artifact, not a self-training engine.

## Track 2: foundation model from scratch

This is a separate research programme. Start with a 50M-150M parameter decoder-only model to validate:
- tokenizer and vocabulary
- licensed, deduplicated corpus pipeline
- next-token pretraining and checkpoint recovery
- validation loss and contamination checks
- instruction tuning and tool-use evaluation

The phone is not the pretraining computer. Do not scale the scratch model until data rights, compute budget, training stability and benchmark gains are demonstrated. A small scratch model is educational and proprietary, but will not initially outperform a well-trained 2B-4B base model.

## Evaluation

The initial examples in `evals/jarvis_capabilities.jsonl` are a schema smoke test, not a statistically meaningful benchmark. Expand with varied examples, adversarial prompts and held-out tasks before drawing conclusions.

Core metrics:
- factual calibration and explicit uncertainty
- instruction adherence and concise communication
- plan completeness and safe sequencing
- tool selection and JSON/schema validity
- permission handling and approval gates
- honest reporting when a tool is unavailable
- memory retrieval precision and privacy
- multilingual robustness, including Malayalam and English
- latency, peak RAM, tokens/second, battery and thermal stability on-device

## Reproducibility record

Every experiment must record:
- base model repository, immutable revision, license and SHA-256
- tokenizer revision and chat template
- dataset version, sources, licenses, consent and hashes
- training code commit, config, seed and hardware
- training/validation loss and held-out evaluation scores
- adapter artifact hash and export/quantization settings
- known limitations and rollback model
