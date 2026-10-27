from cairnly import config


def test_dotenv_does_not_override_real_env(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("# comment\nCAIRNLY_A=from-file\nCAIRNLY_B='quoted'\nnot a pair\n")
    monkeypatch.setenv("CAIRNLY_A", "from-env")
    monkeypatch.delenv("CAIRNLY_B", raising=False)

    config.load_dotenv(env_file)

    import os
    assert os.environ["CAIRNLY_A"] == "from-env"
    assert os.environ["CAIRNLY_B"] == "quoted"


def test_defaults_match_local_stack(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)  # no .env here
    for key in ("DATABASE_URL", "LLM_PROVIDER", "MIN_SCORE"):
        monkeypatch.delenv(key, raising=False)
    config.get_settings.cache_clear()

    s = config.get_settings()

    assert s.database_url.endswith("@localhost:5434/cairnly")
    assert s.llm_provider == "ollama"
    assert 0 < s.min_score < 1
    config.get_settings.cache_clear()
