
import click
import logging
import sys

from .commands import init, db, connect, serve, backup, keys


def configure_logging(verbose):
    """Configure logging based on verbose flag."""
    level = logging.DEBUG if verbose else logging.WARNING
    logging.basicConfig(
        level=level,
        format="%(message)s",
        stream=sys.stderr
    )


@click.group()
@click.option("-v", "--verbose", is_flag=True, help="Enable verbose output")
def cli(verbose):
    """PyroCore CLI - Self-hosted SQLite backend platform."""
    configure_logging(verbose)


# Register subcommands
cli.add_command(init.init)
cli.add_command(db.db)
cli.add_command(connect.connect)
cli.add_command(serve.serve)
cli.add_command(backup.backup)
cli.add_command(keys.keys)

if __name__ == "__main__":
    cli()
