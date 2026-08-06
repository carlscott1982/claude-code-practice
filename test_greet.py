from greet import greet


def test_greet_returns_hello_message():
    assert greet("world") == "Hello, world!"


def test_greet_includes_given_name():
    assert greet("Carl") == "Hello, Carl!"
