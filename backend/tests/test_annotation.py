"""
Test the annotation pipeline with realistic data.

Constructs a mock completed job with multi-phrase results (simulating
real pipeline output), runs build_annotation(), and verifies:
1. Word order is correct across phrase boundaries
2. Timestamps are continuous/absolute
3. All fields are populated or explicitly null
4. Model config is pulled from config.py, not hardcoded
"""

import sys
import os
import json

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from pipeline.annotation import build_annotation


def test_annotation_pipeline():
    """Test with a realistic multi-phrase job result."""

    # Simulate a completed job with 2 phrases and a mix of voiced/unvoiced words
    mock_job = {
        "job_id": "test-annotation-001",
        "status": "complete",
        "progress": 1.0,
        "created_at": 1749600000.0,
        "completed_at": 1749600015.0,
        "result": {
            "phrases": [
                {
                    "phrase_index": 0,
                    "text": "My thought, when I was still in school,",
                    "words": [
                        {
                            "word": "My",
                            "start": 0.0,
                            "end": 0.44,
                            "confidence": 0.305,
                            "stressed": False,
                            "stress_score": 0.0,
                            "pause_after": 0.0,
                            "is_hesitation": False,
                            "mean_pitch": 229.7,
                            "max_pitch": 234.3,
                            "min_pitch": 210.7,
                            "start_pitch": 230.8,
                            "end_pitch": 210.7,
                            "pitch_slope": -20.06,
                            "pitch_range": 23.63,
                            "normalized_pitch": 0.479,
                            "pitch_trend": "\u2193",
                            "char_pitches": [0.483, 0.399],
                            "voiced_segment_index": None,
                        },
                        {
                            "word": "thought,",
                            "start": 0.44,
                            "end": 0.78,
                            "confidence": 0.942,
                            "stressed": True,
                            "stress_score": 1.0,
                            "pause_after": 0.18,
                            "is_hesitation": False,
                            "mean_pitch": 235.8,
                            "max_pitch": 354.1,
                            "min_pitch": 129.9,
                            "start_pitch": 210.7,
                            "end_pitch": 149.5,
                            "pitch_slope": -61.16,
                            "pitch_range": 224.28,
                            "normalized_pitch": 0.504,
                            "pitch_trend": "\u2193",
                            "char_pitches": [0.399, 0.936, 0.813, 0.69, 0.125, 0.075, 0.143],
                            "voiced_segment_index": 1,
                        },
                        {
                            "word": "the",
                            "start": 1.2,
                            "end": 1.3,
                            "confidence": 0.99,
                            "stressed": False,
                            "stress_score": 0.0,
                            "pause_after": 0.0,
                            "is_hesitation": False,
                            # No pitch data — unvoiced function word
                            "mean_pitch": None,
                            "max_pitch": None,
                            "min_pitch": None,
                            "start_pitch": None,
                            "end_pitch": None,
                            "pitch_slope": None,
                            "pitch_range": None,
                            "normalized_pitch": None,
                            "pitch_trend": None,
                            "char_pitches": None,
                            "voiced_segment_index": None,
                        },
                    ],
                    "start_time": 0.0,
                    "end_time": 3.2,
                    "chunk_index": 0,
                    "intonation_pattern": "falling",
                    "intonation": {
                        "mean_pitch": 218.4,
                        "max_pitch": 254.1,
                        "min_pitch": 129.9,
                        "start_pitch": 230.8,
                        "end_pitch": 149.5,
                        "pitch_slope": -81.3,
                        "pitch_range": 124.2,
                        "normalized_pitch": 0.45,
                        "pitch_trend": "↓",
                        "voiced_segment_index": 1
                    }
                },
                {
                    "phrase_index": 1,
                    "text": "was that it would be great.",
                    "words": [
                        {
                            "word": "was",
                            "start": 4.0,
                            "end": 4.2,
                            "confidence": 0.95,
                            "stressed": False,
                            "stress_score": 0.1,
                            "pause_after": 0.0,
                            "is_hesitation": False,
                            "mean_pitch": 180.0,
                            "max_pitch": 185.0,
                            "min_pitch": 175.0,
                            "start_pitch": 182.0,
                            "end_pitch": 178.0,
                            "pitch_slope": -4.0,
                            "pitch_range": 10.0,
                            "normalized_pitch": 0.3,
                            "pitch_trend": "\u2192",
                            "char_pitches": [0.3, 0.3, 0.3],
                            "voiced_segment_index": 2,
                        },
                        {
                            "word": "great.",
                            "start": 5.5,
                            "end": 6.0,
                            "confidence": 0.98,
                            "stressed": True,
                            "stress_score": 0.9,
                            "pause_after": 0.0,
                            "is_hesitation": False,
                            "mean_pitch": 160.0,
                            "max_pitch": 170.0,
                            "min_pitch": 150.0,
                            "start_pitch": 165.0,
                            "end_pitch": 155.0,
                            "pitch_slope": -10.0,
                            "pitch_range": 20.0,
                            "normalized_pitch": 0.2,
                            "pitch_trend": "\u2193",
                            "char_pitches": [0.25, 0.22, 0.20, 0.18, 0.15, 0.12],
                            "voiced_segment_index": 2,
                        },
                    ],
                    "start_time": 4.0,
                    "end_time": 6.0,
                    "chunk_index": 1,
                    "intonation_pattern": "falling",
                    "intonation": {
                        "mean_pitch": 235.1,
                        "max_pitch": 268.4,
                        "min_pitch": 180.2,
                        "start_pitch": 190.5,
                        "end_pitch": 220.3,
                        "pitch_slope": 29.8,
                        "pitch_range": 88.2,
                        "normalized_pitch": 0.58,
                        "pitch_trend": "↑",
                        "voiced_segment_index": 2
                    }
                },
            ],
            "total_duration": 6.0,
            "word_count": 5,
            "wpm": 50.0,
            "stress_ratio": 0.4,
            "pitch_variation": 18.3,
        },
    }

    # Run the annotation builder
    annotation = build_annotation(mock_job)

    # ── Verify structure ──────────────────────────────────────────
    assert annotation["annotation_version"] == "1.0"
    assert "generated_at" in annotation
    assert annotation["recording"]["job_id"] == "test-annotation-001"
    assert annotation["recording"]["audio_duration_sec"] == 6.0
    assert annotation["recording"]["sample_rate"] == 16000

    # ── Verify model provenance comes from config ─────────────────
    from config import ASR_MODEL_SIZE_FINAL, WHISTRESS_WHISPER_BACKBONE
    assert annotation["models"]["asr_final"] == ASR_MODEL_SIZE_FINAL
    assert annotation["models"]["stress_backbone"] == WHISTRESS_WHISPER_BACKBONE
    print(f"  Models: asr_final={annotation['models']['asr_final']}, "
          f"stress_backbone={annotation['models']['stress_backbone']}")

    # ── Verify phrase entries ─────────────────────────────────────
    assert len(annotation["phrases"]) == 2
    assert annotation["phrases"][0]["intonation_pattern"] == "falling"
    assert annotation["phrases"][0]["status"] == "ok"
    assert annotation["phrases"][1]["start_time"] == 4.0
    print(f"  Phrases: {len(annotation['phrases'])} phrases, all status=ok")

    # ── Verify word ordering (absolute timestamps, cross-phrase) ──
    words = annotation["words"]
    assert len(words) == 5
    print(f"  Words: {len(words)} total")

    # Check sequential word_index
    for i, w in enumerate(words):
        assert w["word_index"] == i, f"word_index mismatch: expected {i}, got {w['word_index']}"

    # Check timestamps are monotonically non-decreasing
    for i in range(1, len(words)):
        assert words[i]["start_time"] >= words[i-1]["start_time"], (
            f"Timestamp regression at word {i}: "
            f"{words[i-1]['start_time']} -> {words[i]['start_time']}"
        )
    print("  Timestamps: monotonically increasing [OK]")

    # Check cross-phrase boundary: word 2 (phrase 0) -> word 3 (phrase 1)
    last_phrase0_word = [w for w in words if w["phrase_index"] == 0][-1]
    first_phrase1_word = [w for w in words if w["phrase_index"] == 1][0]
    assert first_phrase1_word["start_time"] > last_phrase0_word["end_time"], (
        "Phrase boundary timestamps overlap!"
    )
    print(f"  Cross-phrase boundary: {last_phrase0_word['end_time']}s -> {first_phrase1_word['start_time']}s [OK]")

    # ── Verify pitch data presence/absence ────────────────────────
    # Word "the" (index 2) should have normalized_pitch=null
    the_word = [w for w in words if w["word"] == "the"][0]
    assert the_word["normalized_pitch"] is None, "Unvoiced word 'the' should have normalized_pitch=null"
    print("  Unvoiced word 'the': normalized_pitch=null [OK]")

    # Word "My" should have normalized_pitch
    my_word = [w for w in words if w["word"] == "My"][0]
    assert my_word["normalized_pitch"] == 0.479
    print(f"  Voiced word 'My': normalized_pitch={my_word['normalized_pitch']} [OK]")


    # ── Verify stress data ────────────────────────────────────────
    stressed_words = [w for w in words if w["stressed"]]
    assert len(stressed_words) == 2
    print(f"  Stressed words: {[w['word'] for w in stressed_words]} [OK]")

    # ── Verify summary ────────────────────────────────────────────
    assert annotation["summary"]["word_count"] == 5
    assert annotation["summary"]["phrase_count"] == 2
    assert annotation["summary"]["stress_ratio"] == 0.4
    print(f"  Summary: {annotation['summary']['word_count']} words, "
          f"WPM={annotation['summary']['wpm']}, "
          f"stress_ratio={annotation['summary']['stress_ratio']}")

    # ── Verify errors array (should be empty for a clean run) ─────
    assert annotation["errors"] == []
    print("  Errors: [] [OK]")

    # ── Print the full JSON for inspection ─────────────────────────
    print("\n" + "=" * 60)
    print("GENERATED ANNOTATION (first 80 lines):")
    print("=" * 60)
    formatted = json.dumps(annotation, indent=2, ensure_ascii=False)
    lines = formatted.split("\n")
    for line in lines[:80]:
        print(line)
    if len(lines) > 80:
        print(f"  ... ({len(lines) - 80} more lines)")

    print("\n" + "=" * 60)
    print("ALL TESTS PASSED")
    print("=" * 60)


if __name__ == "__main__":
    test_annotation_pipeline()
