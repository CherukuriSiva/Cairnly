import pytest

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
    for key in ("DATABASE_URL", "LLM_PROVIDER", "TOP_K"):
        monkeypatch.delenv(key, raising=False)
    config.get_settings.cache_clear()

    s = config.get_settings()

    assert s.database_url.endswith("@localhost:5434/cairnly")
    assert s.llm_provider == "ollama"
    assert s.top_k == 6
    config.get_settings.cache_clear()


def test_defaults_keep_claude_off_and_limits_on(monkeypatch, tmp_path, fresh_settings):
    monkeypatch.chdir(tmp_path)
    for key in ("ALLOW_ANTHROPIC", "CAIRNLY_ENV", "TRUST_PROXY", "TRACE_CONTENT", "CORS_ORIGINS"):
        monkeypatch.delenv(key, raising=False)

    s = fresh_settings()

    assert s.allow_anthropic is False and s.environment == "development"
    assert s.trust_proxy is False and s.trace_content is False
    assert s.cors_origins == ("http://localhost:3010",)
    assert (s.rate_limit_per_minute, s.rate_limit_per_day, s.global_answers_per_day) == (
        10, 200, 2000)
    assert (s.max_concurrent_answers, s.first_token_timeout_s, s.answer_timeout_s) == (4, 90, 60)
    assert not hasattr(s, "anthropic_api_key")  # cairnly never reads the key itself


def test_production_refuses_the_claude_api(monkeypatch, tmp_path, fresh_settings):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("CAIRNLY_ENV", "production")
    monkeypatch.setenv("ALLOW_ANTHROPIC", "true")
    with pytest.raises(ValueError, match="CAIRNLY_ENV=production"):
        fresh_settings()


@pytest.mark.parametrize("value", ["Production", "prod", "production ", " PRODUCTION", "staging",
                                   "", "develop"])
def test_any_environment_but_development_or_test_counts_as_production(
        value, monkeypatch, tmp_path, fresh_settings):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("CAIRNLY_ENV", value)
    monkeypatch.setenv("ALLOW_ANTHROPIC", "true")
    with pytest.raises(ValueError, match="CAIRNLY_ENV=production"):
        fresh_settings()


@pytest.mark.parametrize("value", ["development", "Development ", "TEST", " test"])
def test_development_and_test_allow_the_claude_api_locally(
        value, monkeypatch, tmp_path, fresh_settings):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("CAIRNLY_ENV", value)
    monkeypatch.setenv("ALLOW_ANTHROPIC", "true")
    s = fresh_settings()
    assert s.allow_anthropic is True and s.environment == value.strip().lower()


def test_claude_provider_needs_allow_anthropic(monkeypatch, tmp_path, fresh_settings):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("ALLOW_ANTHROPIC", raising=False)
    monkeypatch.delenv("CAIRNLY_ENV", raising=False)
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    with pytest.raises(ValueError, match="needs ALLOW_ANTHROPIC"):
        fresh_settings()
    monkeypatch.setenv("ALLOW_ANTHROPIC", "TRUE")
    assert fresh_settings().llm_provider == "anthropic"


def test_flags_and_origins_are_parsed_strictly(monkeypatch, tmp_path, fresh_settings):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("TRUST_PROXY", "1")
    monkeypatch.setenv("TRACE_CONTENT", "on")  # not one of 1/true/yes
    monkeypatch.setenv("CORS_ORIGINS", "http://a.test, http://b.test,")

    s = fresh_settings()

    assert s.trust_proxy is True and s.trace_content is False
    assert s.cors_origins == ("http://a.test", "http://b.test")


def test_database_url_from_parts_escapes_the_password(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("DB_HOST", "db.example.internal")
    monkeypatch.setenv("DB_USER", "cairnly")
    monkeypatch.setenv("DB_PASSWORD", "p@ss/w:rd")

    assert config.database_url() == (
        "postgresql://cairnly:p%40ss%2Fw%3Ard@db.example.internal:5432/cairnly?sslmode=require")


def test_database_url_wins_over_parts(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://x")
    monkeypatch.setenv("DB_HOST", "ignored")
    assert config.database_url() == "postgresql://x"
