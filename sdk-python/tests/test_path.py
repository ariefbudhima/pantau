"""Tests for Pantau Python SDK — path normalization."""

import unittest
from pantau.path import normalize_path


class TestPath(unittest.TestCase):

    def test_numeric_ids(self):
        self.assertEqual(normalize_path("/users/42"), "/users/:id")
        self.assertEqual(normalize_path("/products/123/reviews/456"), "/products/:id/reviews/:id")

    def test_uuids(self):
        self.assertEqual(
            normalize_path("/orders/550e8400-e29b-41d4-a716-446655440000"),
            "/orders/:id",
        )

    def test_mongo_object_ids(self):
        self.assertEqual(
            normalize_path("/docs/507f1f77bcf86cd799439011"),
            "/docs/:id",
        )

    def test_long_hex(self):
        self.assertEqual(
            normalize_path("/tx/0a1b2c3d4e5f6a7b8c9d"),
            "/tx/:id",
        )

    def test_plain_routes_unchanged(self):
        self.assertEqual(normalize_path("/health"), "/health")
        self.assertEqual(normalize_path("/api/auth/login"), "/api/auth/login")
        self.assertEqual(normalize_path("/"), "/")
        self.assertEqual(normalize_path(""), "/")

    def test_query_string_stripped(self):
        # Query string should be stripped BEFORE calling normalize_path
        path = "/users/42"
        self.assertEqual(normalize_path(path), "/users/:id")

    def test_mixed_segments(self):
        self.assertEqual(
            normalize_path("/api/users/123/emails/budi@gmail.com"),
            "/api/users/:id/emails/budi@gmail.com",
        )


if __name__ == "__main__":
    unittest.main()
