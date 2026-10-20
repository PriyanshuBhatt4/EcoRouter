"""create_profiles_and_trips

Revision ID: 8c3660e9d20a
Revises: 
Create Date: 2026-10-20 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '8c3660e9d20a'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'profiles',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('auth.users(id)', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('display_name', sa.Text(), nullable=True),
        sa.Column('weight_kg', sa.Numeric(6, 2), nullable=True),
        sa.Column('age', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('idx_profiles_user_id', 'profiles', ['user_id'])

    op.create_table(
        'trips',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('auth.users(id)', ondelete='CASCADE'), nullable=False),
        sa.Column('mode', sa.Text(), nullable=False),
        sa.Column('actual_distance_m', sa.Float(), nullable=False),
        sa.Column('duration_sec', sa.Float(), nullable=False),
        sa.Column('started_at', sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column('finished_at', sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column('route_snapshot', postgresql.JSONB(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('idx_trips_user_id', 'trips', ['user_id'])
    op.create_index('idx_trips_user_id_created_at', 'trips', ['user_id', 'created_at'])

    op.execute('ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE trips ENABLE ROW LEVEL SECURITY;')
    op.execute("CREATE POLICY profiles_select_own ON profiles FOR SELECT USING (auth.uid() = user_id);")
    op.execute("CREATE POLICY profiles_insert_own ON profiles FOR INSERT WITH CHECK (auth.uid() = user_id);")
    op.execute("CREATE POLICY profiles_update_own ON profiles FOR UPDATE USING (auth.uid() = user_id);")
    op.execute("CREATE POLICY trips_select_own ON trips FOR SELECT USING (auth.uid() = user_id);")
    op.execute("CREATE POLICY trips_insert_own ON trips FOR INSERT WITH CHECK (auth.uid() = user_id);")


def downgrade() -> None:
    op.execute('DROP POLICY IF EXISTS trips_insert_own ON trips;')
    op.execute('DROP POLICY IF EXISTS trips_select_own ON trips;')
    op.execute('DROP POLICY IF EXISTS profiles_update_own ON profiles;')
    op.execute('DROP POLICY IF EXISTS profiles_insert_own ON profiles;')
    op.execute('DROP POLICY IF EXISTS profiles_select_own ON profiles;')
    op.execute('DROP TABLE trips;')
    op.execute('DROP TABLE profiles;')
