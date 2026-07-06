"""Tests for Pantau Python SDK — redact module."""

import unittest
from pantau.redact import redact_body, redact_headers, hash_value, partial_mask, REDACTED


class TestRedact(unittest.TestCase):

    def test_mask_secret_keys(self):
        body = {"username": "budi", "password": "rahasia123", "email": "budi@gmail.com"}
        result = redact_body(body, {"hashSecret": "pk_test"})
        self.assertEqual(result["username"], "budi")
        self.assertEqual(result["password"], REDACTED)

    def test_hash_pii_keys(self):
        body = {"email": "budi@gmail.com", "phone": "08123456789"}
        result = redact_body(body, {"hashSecret": "pk_test"})
        # Hashed → starts with #
        self.assertTrue(result["email"].startswith("#"))
        self.assertTrue(result["phone"].startswith("#"))
        # Same input → same hash
        r1 = redact_body({"email": "budi@gmail.com"}, {"hashSecret": "pk_test"})
        r2 = redact_body({"email": "budi@gmail.com"}, {"hashSecret": "pk_test"})
        self.assertEqual(r1["email"], r2["email"])

    def test_hash_deterministic(self):
        h1 = hash_value("budi@gmail.com", "pk_test")
        h2 = hash_value("budi@gmail.com", "pk_test")
        self.assertEqual(h1, h2)
        self.assertTrue(h1.startswith("#"))
        self.assertEqual(len(h1), 17)  # '#' + 16 hex

    def test_hash_without_secret_falls_back_to_mask(self):
        result = redact_body({"email": "no-secret"})
        self.assertEqual(result["email"], REDACTED)

    def test_partial_mask(self):
        result = redact_body(
            {"email": "budi@gmail.com", "phone": "08123456789"},
            {"partialKeys": ["email", "phone"], "hashSecret": "pk_test"},
        )
        self.assertEqual(result["email"], "b***@gmail.com")
        self.assertEqual(result["phone"], "***89")

    def test_nested_objects(self):
        body = {
            "user": {
                "name": "budi",
                "credentials": {
                    "password": "secret",
                    "token": "abc123",
                },
            },
        }
        result = redact_body(body)
        self.assertEqual(result["user"]["name"], "budi")
        self.assertEqual(result["user"]["credentials"]["password"], REDACTED)
        self.assertEqual(result["user"]["credentials"]["token"], REDACTED)

    def test_array_handling(self):
        body = {"items": [{"password": "a"}, {"password": "b"}]}
        result = redact_body(body)
        self.assertEqual(len(result["items"]), 2)
        self.assertEqual(result["items"][0]["password"], REDACTED)
        self.assertEqual(result["items"][1]["password"], REDACTED)

    def test_depth_limit(self):
        # Build deep nested object > MAX_DEPTH
        obj = {"a": None}
        for _ in range(10):
            obj = {"a": obj}
        result = redact_body(obj)
        # Should not recurse infinitely
        self.assertIsNotNone(result)

    def test_redact_headers(self):
        headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer secret123",
            "Cookie": "session=abc",
            "X-Api-Key": "pk_test123",
        }
        result = redact_headers(headers)
        self.assertEqual(result["Content-Type"], "application/json")
        self.assertEqual(result["Authorization"], REDACTED)
        self.assertEqual(result["Cookie"], REDACTED)
        self.assertEqual(result["X-Api-Key"], REDACTED)

    def test_partial_mask_email(self):
        self.assertEqual(partial_mask("budi@gmail.com"), "b***@gmail.com")
        self.assertEqual(partial_mask("a@b.co"), "a***@b.co")

    def test_partial_mask_short(self):
        self.assertEqual(partial_mask("x"), "***")
        self.assertEqual(partial_mask("ab"), "***")
        self.assertEqual(partial_mask("08123456789"), "***89")


if __name__ == "__main__":
    unittest.main()
