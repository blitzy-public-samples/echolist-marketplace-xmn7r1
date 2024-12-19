import { QueryInterface, DataTypes } from 'sequelize';

// Migration to create buyshield_protections table
export async function up(queryInterface: QueryInterface): Promise<void> {
  // Create the buyshield_protections table
  await queryInterface.createTable('buyshield_protections', {
    // Primary key
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },

    // Foreign key relationships
    transactionId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'transactions',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    },
    buyerId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    },
    sellerId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    },

    // Transaction details
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED'),
      allowNull: false,
      defaultValue: 'ACTIVE'
    },
    verificationStatus: {
      type: DataTypes.ENUM('PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED'),
      allowNull: false,
      defaultValue: 'PENDING'
    },
    verificationPhoto: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    escrowId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      unique: true
    },

    // Time tracking
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  });

  // Create indexes for efficient querying
  await queryInterface.addIndex('buyshield_protections', ['transactionId'], {
    name: 'buyshield_transaction_idx',
    using: 'BTREE'
  });

  await queryInterface.addIndex('buyshield_protections', ['buyerId'], {
    name: 'buyshield_buyer_idx',
    using: 'BTREE'
  });

  await queryInterface.addIndex('buyshield_protections', ['sellerId'], {
    name: 'buyshield_seller_idx',
    using: 'BTREE'
  });

  await queryInterface.addIndex('buyshield_protections', ['status'], {
    name: 'buyshield_status_idx',
    using: 'BTREE'
  });

  await queryInterface.addIndex('buyshield_protections', ['escrowId'], {
    name: 'buyshield_escrow_idx',
    using: 'BTREE'
  });
}

// Migration to drop buyshield_protections table
export async function down(queryInterface: QueryInterface): Promise<void> {
  // Drop indexes first
  await queryInterface.removeIndex('buyshield_protections', 'buyshield_transaction_idx');
  await queryInterface.removeIndex('buyshield_protections', 'buyshield_buyer_idx');
  await queryInterface.removeIndex('buyshield_protections', 'buyshield_seller_idx');
  await queryInterface.removeIndex('buyshield_protections', 'buyshield_status_idx');
  await queryInterface.removeIndex('buyshield_protections', 'buyshield_escrow_idx');

  // Drop the table
  await queryInterface.dropTable('buyshield_protections');
}