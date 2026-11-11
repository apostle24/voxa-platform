import unittest

from config import AgentConfig


class AgentConfigTests(unittest.TestCase):
    def setUp(self):
        self.env = {
            "LIVEKIT_URL": "wss://example.livekit.cloud",
            "LIVEKIT_API_KEY": "test-key",
            "LIVEKIT_API_SECRET": "test-secret",
            "OPENAI_API_KEY": "test-openai-key",
        }

    def test_reads_defaults_and_provider_configuration(self):
        config = AgentConfig.from_env(self.env)
        self.assertEqual(config.stt_model, "gpt-4o-mini-transcribe")
        self.assertEqual(config.language, "en")
        self.assertEqual(config.max_participants, 24)

    def test_requires_all_provider_credentials(self):
        del self.env["OPENAI_API_KEY"]
        with self.assertRaisesRegex(ValueError, "OPENAI_API_KEY"):
            AgentConfig.from_env(self.env)

    def test_rejects_unsafe_participant_limit(self):
        self.env["VOXA_LIVE_CAPTIONS_MAX_PARTICIPANTS"] = "500"
        with self.assertRaisesRegex(ValueError, "between 1 and 100"):
            AgentConfig.from_env(self.env)

    def test_accepts_custom_language_model_and_capacity(self):
        self.env.update({
            "VOXA_LIVE_STT_MODEL": "gpt-4o-transcribe",
            "VOXA_LIVE_CAPTIONS_LANGUAGE": "fr",
            "VOXA_LIVE_CAPTIONS_MAX_PARTICIPANTS": "12",
        })
        config = AgentConfig.from_env(self.env)
        self.assertEqual((config.stt_model, config.language, config.max_participants), ("gpt-4o-transcribe", "fr", 12))


if __name__ == "__main__":
    unittest.main()
