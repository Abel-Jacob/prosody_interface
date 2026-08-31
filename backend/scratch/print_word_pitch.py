import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from tests import test_annotation

anno = test_annotation.run_annotation_for_test()
for w in anno["words"]:
    print(f"Word: {w['word']}")
    print(f"  mean: {w['mean_pitch']}")
    print(f"  start: {w['start_pitch']}")
    print(f"  end: {w['end_pitch']}")
    print(f"  slope: {w['pitch_slope']}")
    print(f"  trend: {w['pitch_trend']}")
