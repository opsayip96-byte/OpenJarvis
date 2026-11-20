#!/usr/bin/env python3
"""Train a private JARVIS LoRA adapter from explicitly reviewed JSONL examples.

Run on a suitable training workstation, not on the Android phone. No hosted
inference or automatic upload is performed by this script.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
from pathlib import Path

from datasets import Dataset
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer, set_seed
from trl import SFTConfig, SFTTrainer


def load_records(path: Path) -> list[dict]:
    rows: list[dict] = []
    seen: set[str] = set()
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{path}:{line_no}: invalid JSON: {exc}") from exc
        messages = row.get("messages")
        if not isinstance(messages, list) or len(messages) < 2:
            raise ValueError(f"{path}:{line_no}: expected at least user and assistant messages")
        if not any(isinstance(m, dict) and m.get("role") == "user" for m in messages):
            raise ValueError(f"{path}:{line_no}: no user message")
        if not any(isinstance(m, dict) and m.get("role") == "assistant" and isinstance(m.get("content"), str) and m["content"].strip() for m in messages):
            raise ValueError(f"{path}:{line_no}: no non-empty assistant target")
        if any(not isinstance(m, dict) or m.get("role") not in {"system", "user", "assistant"} or not isinstance(m.get("content"), str) for m in messages):
            raise ValueError(f"{path}:{line_no}: unsupported or malformed message")
        fingerprint = hashlib.sha256(json.dumps(messages, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        rows.append({"messages": messages, "id": str(row.get("id", f"line-{line_no}"))})
    if len(rows) < 2:
        raise ValueError(f"Need at least 2 unique reviewed examples for train/validation split; found {len(rows)}")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-model", default="Qwen/Qwen3-1.7B")
    parser.add_argument("--train", type=Path, default=Path("training/data/jarvis_seed_sft.jsonl"))
    parser.add_argument("--output", type=Path, default=Path("training/output/jarvis-lora"))
    parser.add_argument("--epochs", type=float, default=3.0)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--grad-accum", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=1e-4)
    parser.add_argument("--eval-fraction", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    if not 0.05 <= args.eval_fraction <= 0.5:
        parser.error("--eval-fraction must be between 0.05 and 0.5")
    set_seed(args.seed)
    records = load_records(args.train)
    tokenizer = AutoTokenizer.from_pretrained(args.base_model, trust_remote_code=False)
    if tokenizer.chat_template is None:
        raise RuntimeError("Base model tokenizer has no chat template; configure the official template before training.")

    # Render conversations before training. This avoids passing raw nested
    # message dictionaries to TRL's text dataset pipeline.
    rendered = []
    for row in records:
        text = tokenizer.apply_chat_template(row["messages"], tokenize=False, add_generation_prompt=False, enable_thinking=False)
        if not isinstance(text, str) or not text.strip():
            raise ValueError(f"Chat template produced empty text for {row['id']}")
        rendered.append({"text": text, "id": row["id"]})

    random.Random(args.seed).shuffle(rendered)
    eval_count = max(1, min(len(rendered) - 1, round(len(rendered) * args.eval_fraction)))
    eval_rows = rendered[:eval_count]
    train_rows = rendered[eval_count:]
    train_dataset = Dataset.from_list(train_rows)
    eval_dataset = Dataset.from_list(eval_rows)

    model = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        torch_dtype="auto",
        device_map="auto",
        trust_remote_code=False,
    )
    lora = LoraConfig(
        r=16,
        lora_alpha=32,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules="all-linear",
    )
    config = SFTConfig(
        output_dir=str(args.output),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=1,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.learning_rate,
        logging_steps=5,
        eval_strategy="epoch",
        save_strategy="epoch",
        report_to="none",
        max_length=2048,
        packing=False,
        gradient_checkpointing=True,
        fp16=False,
        bf16=False,
        dataset_text_field="text",
        assistant_only_loss=True,
        seed=args.seed,
        data_seed=args.seed,
    )
    trainer = SFTTrainer(
        model=model,
        args=config,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        processing_class=tokenizer,
        peft_config=lora,
    )
    trainer.train()
    metrics = trainer.evaluate()
    args.output.mkdir(parents=True, exist_ok=True)
    trainer.save_model(str(args.output))
    tokenizer.save_pretrained(str(args.output))
    (args.output / "evaluation_metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    (args.output / "JARVIS_MODEL_CARD.txt").write_text(
        "JARVIS private LoRA adapter.\n"
        f"Base model: {args.base_model}\n"
        f"Training data: {args.train}\n"
        f"Unique reviewed records: {len(records)}\n"
        f"Training records: {len(train_rows)}\n"
        f"Validation records: {len(eval_rows)}\n"
        f"Seed: {args.seed}\n"
        "Validation is a small smoke check, not proof of general capability. Run a separate held-out capability suite before deployment.\n"
        "Review the base model license before distributing or deploying the adapter.\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
