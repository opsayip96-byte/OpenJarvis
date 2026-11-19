#!/usr/bin/env python3
"""Train a private JARVIS LoRA adapter from reviewed JSONL chat examples.

Run on a suitable training workstation, not on the Android phone.
This script never uploads data or calls a hosted inference API.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from datasets import Dataset
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer
from trl import SFTConfig, SFTTrainer


def load_records(path: Path) -> list[dict]:
    rows = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        messages = row.get("messages")
        if not isinstance(messages, list) or not messages:
            raise ValueError(f"{path}:{line_no}: missing messages")
        if not any(m.get("role") == "assistant" for m in messages):
            raise ValueError(f"{path}:{line_no}: no assistant response")
        rows.append({"messages": messages, "id": row.get("id", f"line-{line_no}")})
    if not rows:
        raise ValueError(f"No training records found in {path}")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-model", default="Qwen/Qwen3.5-2B-Base")
    parser.add_argument("--train", type=Path, default=Path("training/data/jarvis_seed_sft.jsonl"))
    parser.add_argument("--output", type=Path, default=Path("training/output/jarvis-lora"))
    parser.add_argument("--epochs", type=float, default=3.0)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--grad-accum", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=1e-4)
    args = parser.parse_args()

    records = load_records(args.train)
    tokenizer = AutoTokenizer.from_pretrained(args.base_model, trust_remote_code=False)
    if tokenizer.chat_template is None:
        raise RuntimeError("Base model tokenizer has no chat template; configure the official template before training.")

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
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.learning_rate,
        logging_steps=5,
        save_strategy="epoch",
        report_to="none",
        max_length=2048,
        packing=False,
        gradient_checkpointing=True,
        fp16=False,
        bf16=False,
        dataset_text_field=None,
        completion_only_loss=False,
    )
    trainer = SFTTrainer(
        model=model,
        args=config,
        train_dataset=Dataset.from_list(records),
        processing_class=tokenizer,
        peft_config=lora,
    )
    trainer.train()
    args.output.mkdir(parents=True, exist_ok=True)
    trainer.save_model(str(args.output))
    tokenizer.save_pretrained(str(args.output))
    (args.output / "JARVIS_MODEL_CARD.txt").write_text(
        "JARVIS private LoRA adapter.\n"
        f"Base model: {args.base_model}\n"
        f"Training data: {args.train}\n"
        f"Records: {len(records)}\n"
        "Review the base model license and run held-out evaluations before deployment.\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
