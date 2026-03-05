from __future__ import annotations

import unittest

from training.evaluation import PurgedWalkForwardValidator


class WalkForwardSplitTest(unittest.TestCase):
    def test_purged_split_has_no_overlap(self) -> None:
        validator = PurgedWalkForwardValidator(
            n_splits=4,
            train_size=100,
            test_size=20,
            purge_size=5,
            embargo_size=3,
            expanding=False,
        )
        for train_idx, test_idx in validator.split(320):
            train_set = set(train_idx.tolist())
            test_set = set(test_idx.tolist())
            self.assertEqual(len(train_set.intersection(test_set)), 0)
            self.assertLess(max(train_set), min(test_set))
            self.assertGreaterEqual(min(test_set) - max(train_set), 5)


if __name__ == "__main__":
    unittest.main()
