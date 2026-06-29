from setuptools import find_packages, setup


setup(
    name="sageum-agent",
    version="0.1.0",
    description="Sageum curriculum generation worker",
    packages=find_packages(include=["sageum_agent", "sageum_agent.*"]),
    python_requires=">=3.9,<3.14",
    install_requires=[
        "fastapi>=0.104.0,<1",
        "httpx>=0.28.0,<1",
        "pydantic>=2.7.0,<3",
        "uvicorn[standard]>=0.24.0,<1",
    ],
    entry_points={
        "console_scripts": [
            "sageum=sageum_agent.tui:main",
            "sageum-agent=sageum_agent.cli:main",
        ],
    },
)
