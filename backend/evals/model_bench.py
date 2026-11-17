"""Compares chat models on this app's workload over several runs: latency with ~200 reviews,
guardrail pass rate, off-topic leaks, and whether the sizing answer follows the review evidence.

Run from backend/:  .venv/bin/python -m evals.model_bench gpt-6-luna gpt-5-mini --runs 5
"""
import argparse
import asyncio
import statistics
import time

from dotenv import load_dotenv

load_dotenv(".env")

from openai import AsyncOpenAI, BadRequestError  # noqa: E402

from app import llm  # noqa: E402
from app.schemas import Product  # noqa: E402
from evals import guardrail_eval  # noqa: E402

client = AsyncOpenAI()
EFFORTS = ["minimal", "none", "low"]
BIG_PRODUCT = Product(
    site="amazon",
    url="u",
    title="Test earbuds",
    rating_breakdown="5★ 52%, 4★ 21%, 3★ 8%, 2★ 4%, 1★ 15%",
    reviews=[
        {
            "title": f"Review {i}",
            "body": ("Battery lasts about a day and a half with moderate use. Sound is clear, bass is decent. " * 3)[:300],
            "rating": 5 - i % 5,
            "source": ["top", "critical", "recent"][i % 3],
        }
        for i in range(200)
    ],
)


async def fastest_effort(model: str) -> str:
    for effort in EFFORTS:
        try:
            await client.responses.create(model=model, input="hi", reasoning={"effort": effort}, max_output_tokens=16)
            return effort
        except BadRequestError as err:
            if "reasoning" not in str(err).lower() and "effort" not in str(err).lower():
                raise
    raise RuntimeError(f"{model}: no supported reasoning effort in {EFFORTS}")


async def one_latency(model: str, effort: str) -> tuple:
    started, first, usage = time.perf_counter(), None, None
    stream = await client.responses.create(
        model=model,
        instructions=llm.CHAT_INSTRUCTIONS + "\n\n" + llm.build_product_context(BIG_PRODUCT),
        input=[{"role": "user", "content": "Is the battery good?"}],
        reasoning={"effort": effort},
        stream=True,
    )
    async for ev in stream:
        if ev.type == "response.output_text.delta" and first is None:
            first = time.perf_counter() - started
        elif ev.type == "response.completed":
            usage = ev.response.usage
    return first or 0.0, time.perf_counter() - started, usage.output_tokens


async def one_quality(model: str, effort: str) -> tuple:
    llm.MODEL, llm.CHAT_REASONING_EFFORT = model, effort
    ge = guardrail_eval
    cases = [(q, "off") for q in ge.OFF_TOPIC] + [(q, "on") for q in ge.ON_TOPIC]
    n_guard, n_mixed = len(cases), len(ge.MIXED)
    answers = await asyncio.gather(
        *(ge.ask(q) for q, _ in cases),
        *(ge.ask(q) for q, _ in ge.MIXED),
        *(ge.ask(q) for q, _ in ge.CHOICE),
    )
    guard, mixed, choice = answers[:n_guard], answers[n_guard : n_guard + n_mixed], answers[n_guard + n_mixed :]
    passed = sum(ge.declined(a) == (kind == "off") for (_, kind), a in zip(cases, guard))
    leaks = sum(leak in a.lower().replace(",", "") for (_, leak), a in zip(ge.MIXED, mixed))
    picks = sum(ge.first_line_picks(a, pattern) for (_, pattern), a in zip(ge.CHOICE, choice))
    return passed, n_guard, leaks, picks


def spread(values: list) -> str:
    return f"{statistics.median(values):4.1f}s ({min(values):.1f}–{max(values):.1f})"


async def bench(model: str, runs: int) -> None:
    effort = await fastest_effort(model)
    latencies = [await one_latency(model, effort) for _ in range(runs)]  # sequential: no self-contention
    quality = [await one_quality(model, effort) for _ in range(runs)]
    firsts, totals, tokens = zip(*latencies)
    passed = sum(q[0] for q in quality)
    total = sum(q[1] for q in quality)
    leaks = sum(q[2] for q in quality)
    picks = sum(q[3] for q in quality)
    print(
        f"{model:14s} effort={effort:7s} first word {spread(list(firsts))}  full {spread(list(totals))}  "
        f"out {statistics.median(tokens):.0f} tok\n"
        f"{'':14s} guardrail {passed}/{total}  mixed leaks {leaks}/{len(guardrail_eval.MIXED) * runs}  "
        f"choice answers follow evidence {picks}/{len(guardrail_eval.CHOICE) * runs}",
        flush=True,
    )


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("models", nargs="+")
    parser.add_argument("--runs", type=int, default=5)
    args = parser.parse_args()
    print(f"{args.runs} runs per model; latency shown as median (min–max)\n")
    for model in args.models:
        try:
            await bench(model, args.runs)
        except Exception as err:  # keep benchmarking the other models
            print(f"{model:14s} ERROR {str(err)[:150]}")


if __name__ == "__main__":
    asyncio.run(main())
