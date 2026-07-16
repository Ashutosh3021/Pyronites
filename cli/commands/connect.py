
from pathlib import Path

import click

from cli.config import error


# Find the connectors directory relative to this file
CONNECTORS_DIR = Path(__file__).parent.parent.parent / "connectors"


def _read_template(path: Path) -> str:
    """Read a connector template file, raising a clean error if it's missing."""
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise FileNotFoundError(
            f"Template file not found: {path}. "
            "Your PyroCore installation may be incomplete."
        )


def get_nextjs_files():
    """Get Next.js template files from connectors dir."""
    return [
        (".env.local", _read_template(CONNECTORS_DIR / "nextjs.env.local.template")),
        ("lib/pyrocore.ts", _read_template(CONNECTORS_DIR / "nextjs.pyrocore.ts.template")),
    ]


def get_python_files():
    """Get Python template file from connectors dir."""
    return [
        ("pyrocore_client.py", _read_template(CONNECTORS_DIR / "python.client.py.template")),
    ]


def get_prisma_files():
    """Get Prisma template file from connectors dir."""
    return [
        ("schema.prisma", _read_template(CONNECTORS_DIR / "prisma.schema.prisma.template")),
    ]


FRAMEWORK_FILES = {
    "nextjs": get_nextjs_files,
    "python": get_python_files,
    "prisma": get_prisma_files,
}


@click.command()
@click.argument("framework", type=click.Choice(list(FRAMEWORK_FILES.keys())))
@click.option("--force", is_flag=True, help="Overwrite existing files if they exist")
@click.option("-v", "--verbose", is_flag=True, help="Enable verbose output")
def connect(framework, force, verbose):
    """
    Generate framework-specific configuration files.

    FRAMEWORK: Framework to generate config for (nextjs, python, prisma)
    """
    try:
        # Get list of (filename, content) tuples for this framework
        get_files = FRAMEWORK_FILES[framework]
        files_to_write = get_files()
        
        # Check if any files already exist (unless --force is used)
        existing_files = []
        for filename, _ in files_to_write:
            fp = Path(filename)
            if fp.exists():
                existing_files.append(filename)
        
        if existing_files and not force:
            error(
                f"File(s) already exist: {', '.join(existing_files)}. Use --force to overwrite."
            )
        
        # Write all files
        for filename, content in files_to_write:
            fp = Path(filename)
            # Create parent directories if needed
            fp.parent.mkdir(parents=True, exist_ok=True)
            fp.write_text(content)
            click.secho(f"✓ Generated {filename}", fg="green")
        
        click.echo()
        click.echo("Next steps:")
        if framework == "nextjs":
            click.echo("  1. Update PYROCORE_API_KEY in .env.local with your actual API key")
            click.echo("  2. Start the PyroCore server: pyrocore start")
        elif framework == "prisma":
            click.echo("  1. Run prisma db pull to introspect the database")
            click.echo("  2. Run prisma generate to generate the client")
        elif framework == "python":
            click.echo("  1. Set your API key as PYROCORE_API_KEY environment variable")
            click.echo("  2. Use the PyroCoreClient in pyrocore_client.py")
        
    except Exception as e:
        if verbose:
            import traceback
            traceback.print_exc()
        error(str(e))
