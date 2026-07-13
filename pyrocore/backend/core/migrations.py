
import glob
import os
import re
from datetime import datetime
from typing import List, Set
from .db import Database, DatabaseError


def get_migration_files(migrations_dir: str) -> List[str]:
    """
    Get a list of migration files in the given directory, sorted numerically.
    
    Args:
        migrations_dir: Path to directory containing migration files
        
    Returns:
        Sorted list of migration file paths
    """
    if not os.path.exists(migrations_dir):
        return []
    
    pattern = os.path.join(migrations_dir, "*.sql")
    files = glob.glob(pattern)
    
    # Sort migration files numerically based on their ID prefix
    def migration_sort_key(file_path: str) -> int:
        filename = os.path.basename(file_path)
        match = re.match(r"^(\d+)", filename)
        if match:
            return int(match.group(1))
        return 0  # Fallback for invalid filenames
    
    return sorted(files, key=migration_sort_key)


def extract_migration_id(file_path: str) -> str:
    """
    Extract migration ID from a migration file path.
    
    Args:
        file_path: Path to migration file
        
    Returns:
        Migration ID (e.g., "0001" from "0001_init.sql")
    """
    filename = os.path.basename(file_path)
    match = re.match(r"^(\d+)", filename)
    if match:
        return match.group(1)
    raise ValueError(f"Invalid migration filename: {filename}")


def get_applied_migrations(db: Database) -> Set[str]:
    """
    Get set of migrations that have already been applied.
    
    Args:
        db: Database instance
        
    Returns:
        Set of applied migration IDs
    """
    try:
        # First check if migrations table exists
        cursor = db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'"
        )
        if not cursor.fetchone():
            return set()
        
        # Get applied migrations
        cursor = db.execute("SELECT id FROM migrations")
        return {row[0] for row in cursor.fetchall()}
    except DatabaseError:
        return set()


def apply_migration(db: Database, file_path: str) -> None:
    """
    Apply a single migration file within a transaction.
    
    Args:
        db: Database instance
        file_path: Path to migration SQL file
        
    Raises:
        DatabaseError: If migration fails
    """
    migration_id = extract_migration_id(file_path)
    migration_name = os.path.basename(file_path)
    
    try:
        # Read migration SQL
        with open(file_path, "r", encoding="utf-8") as f:
            sql_content = f.read()
        
        # Split into individual statements (basic splitting, handles comments)
        statements = []
        current_statement = []
        in_comment = False
        
        for line in sql_content.splitlines():
            line = line.strip()
            
            # Skip empty lines
            if not line:
                continue
                
            # Skip comment-only lines
            if line.startswith("--"):
                continue
                
            # Handle multi-line comments (basic support)
            if "/*" in line:
                in_comment = True
            if "*/" in line:
                in_comment = False
                line = line.split("*/", 1)[1].strip()
                if not line:
                    continue
            if in_comment:
                continue
                
            current_statement.append(line)
            
            # If line ends with semicolon, we have a complete statement
            if line.endswith(";"):
                full_statement = " ".join(current_statement).strip()
                if full_statement:
                    statements.append(full_statement)
                current_statement = []
        
        # Apply migration in transaction
        with db.transaction() as conn:
            # Execute each statement individually
            for statement in statements:
                conn.execute(statement)
            
            # Record migration as applied
            conn.execute(
                "INSERT INTO migrations (id, name) VALUES (?, ?)",
                (migration_id, migration_name)
            )
            
    except Exception as e:
        raise DatabaseError(
            f"Failed to apply migration {migration_name}: {e}"
        ) from e


def run_pending_migrations(db: Database, migrations_dir: str) -> None:
    """
    Run all pending migrations in order.
    
    Args:
        db: Database instance
        migrations_dir: Path to directory containing migration files
    """
    migration_files = get_migration_files(migrations_dir)
    applied_migrations = get_applied_migrations(db)
    
    for file_path in migration_files:
        migration_id = extract_migration_id(file_path)
        if migration_id not in applied_migrations:
            apply_migration(db, file_path)

