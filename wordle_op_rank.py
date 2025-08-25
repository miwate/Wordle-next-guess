#!/usr/bin/env python3
import math
from collections import Counter
from multiprocessing import Pool, cpu_count


with open("answers.txt") as f:
    answers = [w.strip() for w in f if len(w.strip()) == 5]

with open("guesses.txt") as f:
    guesses = [w.strip() for w in f if len(w.strip()) == 5]

# Compute feedback
def get_pattern(guess: str, answer: str) -> str:
    pattern = [""] * 5
    answer_chars = list(answer)

    # Green
    for i, ch in enumerate(guess):
        if ch == answer[i]:
            pattern[i] = "G"
            answer_chars[i] = None

    # Yellow Black
    for i, ch in enumerate(guess):
        if pattern[i] == "":
            if ch in answer_chars:
                pattern[i] = "Y"
                answer_chars[answer_chars.index(ch)] = None
            else:
                pattern[i] = "B"

    return "".join(pattern)

# Entropy
def entropy_of_guess(guess: str, possible_answers) -> float:
    hist = Counter(get_pattern(guess, ans) for ans in possible_answers)
    total = len(possible_answers)
    return -sum((count / total) * math.log2(count / total) for count in hist.values())

# Multiproc
def _worker_guess_entropy(guess):
    return (entropy_of_guess(guess, answers), guess)

def rank_all_guesses(use_multiprocessing=True, out_words_file="ranked_words.txt",
                     out_with_entropy="ranked_with_entropy.txt"):
    if use_multiprocessing and cpu_count() > 1:
        print(f"Using multiprocessing with {cpu_count()} workers...")
        with Pool() as pool:
            results = pool.map(_worker_guess_entropy, guesses)
    else:
        print("Using single-threaded computation (no multiprocessing).")
        results = []
        for i, g in enumerate(guesses, start=1):
            score = entropy_of_guess(g, answers)
            results.append((score, g))
            if i % 500 == 0:
                print(f"Processed {i}/{len(guesses)} guesses...")

    # Sort
    results.sort(key=lambda x: (-x[0], x[1]))

    # Files
    best_openers = results[:100]
    worst10 = results[-10:]

    with open("best_openers.txt", "w") as f:
        for score, word in best_openers:
            f.write(f"{word}\t{score:.3f}\n")

    """
    with open("worst10_openers.txt", "w") as f:
        for score, word in worst10:
            f.write(f"{word}\t{score:.3f}\n")
    
    
    with open(out_with_entropy, "w") as f:
        f.write("rank\tword\tentropy\n")
        for rank, (score, word) in enumerate(results, start=1):
            f.write(f"{rank}\t{word}\t{score:.6f}\n")
    """

    # print(f"Done. Wrote {len(results)} words to '{out_words_file}' (one per line).")
    print(f"Also wrote best10 and worst10 openers.")

if __name__ == "__main__":
    rank_all_guesses(use_multiprocessing=True) # or False if no multiproc
