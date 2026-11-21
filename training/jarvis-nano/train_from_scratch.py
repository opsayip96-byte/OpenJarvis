#!/usr/bin/env python3
"""Train JARVIS-Nano from random initialization.

Accepts plain-text documents or JSONL records with a text/content field, or
OpenAI-style messages arrays. No pretrained weights are loaded.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from datasets import Dataset
from tokenizers import Tokenizer, decoders, models, pre_tokenizers, trainers
from transformers import (
    DataCollatorForLanguageModeling,
    LlamaConfig,
    LlamaForCausalLM,
    PreTrainedTokenizerFast,
    Trainer,
    TrainingArguments,
    set_seed,
)

SPECIAL = ["<|pad|>", "<|unk|>", "<|bos|>", "<|eos|>", "<|user|>", "<|assistant|>", "<|system|>"]


def format_messages(messages: list[dict]) -> str:
    """Preserve conversation roles when the source is chat-formatted JSONL."""
    chunks = []
    for message in messages:
        if not isinstance(message, dict):
            continue
        role = str(message.get("role", "user")).lower()
        if role not in {"system", "user", "assistant"}:
            continue
        body = message.get("content", "")
        if isinstance(body, list):
            body = " ".join(str(part.get("text", "")) if isinstance(part, dict) else str(part) for part in body)
        if body:
            chunks.append(f"<|{role}|>{body}")
    return "\\n".join(chunks)


def read_documents(path: Path) -> list[str]:
    docs: list[str] = []
    with path.open("r", encoding="utf-8") as stream:
        for line in stream:
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
                if isinstance(item, dict) and isinstance(item.get("messages"), list):
                    text = format_messages(item["messages"])
                elif isinstance(item, dict):
                    text = item.get("text") or item.get("content") or ""
                else:
                    text = str(item)
            except json.JSONDecodeError:
                text = line
            if isinstance(text, str) and text.strip():
                docs.append(text.strip())
    if not docs:
        raise ValueError(f"No usable text documents found in {path}")
    return docs


def train_tokenizer(docs: list[str], output: Path, vocab_size: int) -> PreTrainedTokenizerFast:
    tokenizer = Tokenizer(models.BPE(unk_token="<|unk|>"))
    tokenizer.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tokenizer.decoder = decoders.ByteLevel()
    trainer = trainers.BpeTrainer(
        vocab_size=vocab_size,
        min_frequency=2,
        special_tokens=SPECIAL,
        initial_alphabet=pre_tokenizers.ByteLevel.alphabet(),
    )
    tokenizer.train_from_iterator(docs, trainer=trainer)
    raw_path = output / "tokenizer.json"
    tokenizer.save(str(raw_path))
    fast = PreTrainedTokenizerFast(
        tokenizer_file=str(raw_path),
        unk_token="<|unk|>",
        pad_token="<|pad|>",
        bos_token="<|bos|>",
        eos_token="<|eos|>",
        additional_special_tokens=["<|user|>", "<|assistant|>", "<|system|>"],
    )
    fast.chat_template = (
        "{% for message in messages %}"
        "{% if message['role'] == 'system' %}<|system|>{{ message['content'] }}{% endif %}"
        "{% if message['role'] == 'user' %}<|user|>{{ message['content'] }}{% endif %}"
        "{% if message['role'] == 'assistant' %}<|assistant|>{{ message['content'] }}{% endif %}"
        "{% endfor %}{% if add_generation_prompt %}<|assistant|>{% endif %}"
    )
    fast.save_pretrained(output)
    return fast


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True, type=Path, help="UTF-8 TXT or JSONL training corpus")
    parser.add_argument("--output", type=Path, default=Path("artifacts/jarvis-nano"))
    parser.add_argument("--vocab-size", type=int, default=16000)
    parser.add_argument("--sequence-length", type=int, default=1024)
    parser.add_argument("--epochs", type=float, default=1.0)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--gradient-accumulation", type=int, default=16)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--hidden-size", type=int, default=768)
    parser.add_argument("--layers", type=int, default=12)
    parser.add_argument("--heads", type=int, default=12)
    parser.add_argument("--intermediate-size", type=int, default=2048)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    if args.vocab_size < 512 or args.sequence_length < 128:
        raise ValueError("vocab-size must be >=512 and sequence-length >=128")
    if args.hidden_size % args.heads:
        raise ValueError("hidden-size must be divisible by heads")
    if args.layers < 1 or args.heads < 1:
        raise ValueError("layers and heads must be positive")

    set_seed(args.seed)
    args.output.mkdir(parents=True, exist_ok=True)
    docs = read_documents(args.data)
    tokenizer = train_tokenizer(docs, args.output, args.vocab_size)

    config = LlamaConfig(
        vocab_size=len(tokenizer),
        hidden_size=args.hidden_size,
        intermediate_size=args.intermediate_size,
        num_hidden_layers=args.layers,
        num_attention_heads=args.heads,
        num_key_value_heads=args.heads,
        max_position_embeddings=args.sequence_length,
        rms_norm_eps=1e-5,
        rope_theta=10000.0,
        tie_word_embeddings=False,
        bos_token_id=tokenizer.bos_token_id,
        eos_token_id=tokenizer.eos_token_id,
        pad_token_id=tokenizer.pad_token_id,
    )
    model = LlamaForCausalLM(config)  # Random initialization, never from_pretrained().
    model.config.use_cache = False

    # Keep document boundaries explicit so unrelated documents do not blend.
    encoded = tokenizer(docs, truncation=False, add_special_tokens=False)["input_ids"]
    flat: list[int] = []
    for document in encoded:
        flat.extend(document)
        flat.append(tokenizer.eos_token_id)
    block = args.sequence_length
    usable = (len(flat) // block) * block
    if usable < block * 8:
        raise ValueError(
            f"Corpus is too small after tokenization ({usable} tokens). "
            "Provide at least 8 full sequence blocks; useful quality requires far more."
        )
    chunks = [flat[i:i + block] for i in range(0, usable, block)]
    dataset = Dataset.from_dict({"input_ids": chunks})
    dataset = dataset.map(lambda row: {"attention_mask": [1] * len(row["input_ids"])})

    cuda = torch.cuda.is_available()
    bf16 = bool(cuda and torch.cuda.is_bf16_supported())
    fp16 = bool(cuda and not bf16)
    print(f"Training device: {'CUDA' if cuda else 'CPU'} | bf16={bf16} | fp16={fp16}")
    if not cuda:
        print("WARNING: CPU training is a smoke-test path, not practical for the default model.")

    training_args = TrainingArguments(
        output_dir=str(args.output / "checkpoints"),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.gradient_accumulation,
        learning_rate=args.learning_rate,
        warmup_ratio=0.03,
        weight_decay=0.1,
        lr_scheduler_type="cosine",
        logging_steps=10,
        save_steps=500,
        save_total_limit=2,
        bf16=bf16,
        fp16=fp16,
        gradient_checkpointing=True,
        optim="adamw_torch",
        report_to=[],
        remove_unused_columns=False,
        dataloader_num_workers=2 if cuda else 0,
    )
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=dataset,
        data_collator=DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False),
    )
    result = trainer.train()
    model.config.use_cache = True
    trainer.save_model(str(args.output / "hf"))
    tokenizer.save_pretrained(args.output / "hf")
    metadata = {
        "name": "JARVIS-Nano",
        "version": "0.1.0",
        "architecture": "LlamaForCausalLM-compatible",
        "initialization": "random",
        "pretrained_base_model": None,
        "parameters": sum(p.numel() for p in model.parameters()),
        "training_documents": len(docs),
        "training_tokens": usable,
        "sequence_length": block,
        "train_loss": result.metrics.get("train_loss"),
        "training_device": "cuda" if cuda else "cpu",
        "note": "New randomly initialized research model. Quality depends on corpus scale and evaluation; not comparable to large foundation models.",
    }
    (args.output / "model-card.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
