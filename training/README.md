# JARVIS private model lab

This directory is for building a private JARVIS assistant model and, later, a separate foundation-model research project. It is not a publishing workflow.

## Track 1: private JARVIS model

1. Choose and pin an openly licensed base model and exact revision.
2. Download and verify the weights and tokenizer on a development machine.
3. Build a small, reviewed JARVIS dataset from authored examples and user-approved, sanitized examples only.
4. Split by task family into train, validation and held-out test sets. Keep test prompts out of training.
5. Establish base-model scores before fine-tuning.
6. Train a LoRA/PEFT adapter with a reproducible config and fixed seed.
7. Compare adapter vs base on held-out tests, including tool argument validity and false capability claims.
8. Export/merge the adapter only if it improves the target tasks without unacceptable regressions.
9. Convert to a supported local inference format, verify hashes, then test on the target Android device.

A one-time training machine is required for practical fine-tuning. This is not a runtime API: after packaging, inference is local on the phone.

## Track 2: foundation model from scratch

This is a separate research programme. Start with a 50M-150M parameter decoder-only model to validate:
- tokenizer and vocabulary
- licensed, deduplicated corpus pipeline
- next-token pretraining and checkpoint recovery
- validation loss and contamination checks
- instruction tuning and tool-use evaluation

The phone is not the pretraining computer. Do not scale the scratch model until data rights, compute budget, training stability and benchmark gains are demonstrated. A small scratch model is educational and proprietary, but will not initially outperform a well-trained 2B-4B base model.

## Dataset safety

- Do not ingest passwords, API keys, financial credentials, private messages, medical data or other sensitive information.
- Do not use chat histories by default. Require explicit selection, sanitization and consent for any personal examples.
- Store source, consent, license, transformation and split metadata for every training record.
- Remove duplicates and near-duplicates across splits.
- Keep evaluation data separate and versioned.
- Use only synthetic/authored examples or data with clear permission and compatible licenses.

## Evaluation

The initial examples in `evals/jarvis_capabilities.jsonl` are a schema smoke test, not a statistically meaningful benchmark. Expand with many varied examples, adversarial prompts and held-out tasks before drawing conclusions.

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
