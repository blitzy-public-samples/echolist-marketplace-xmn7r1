import { QueryInterface, DataTypes } from 'sequelize';

// Migration for creating transactions table
export const up = async (queryInterface: QueryInterface): Promise<void> => {
  // Create UUID extension if not exists
  await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

  // Create transaction status enum type
  await queryInterface.sequelize.query(`
    CREATE TYPE transaction_status AS ENUM (
      'PENDING',
      'PROCESSING',
      'COMPLETED',
      'CANCELLED',
      'REFUNDED',
      'DISPUTED'
    );
  `);

  // Create payment method enum type
  await queryInterface.sequelize.query(`
    CREATE TYPE payment_method AS ENUM (
      'CREDIT_CARD',
      'DEBIT_CARD',
      'BANK_TRANSFER',
      'PLATFORM_CREDIT'
    );
  `);

  // Create transactions table
  await queryInterface.createTable('transactions', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    listingId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'listings',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },
    buyerId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    sellerId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        min: 0.01
      }
    },
    status: {
      type: 'transaction_status',
      allowNull: false,
      defaultValue: 'PENDING'
    },
    paymentMethod: {
      type: 'payment_method',
      allowNull: false
    },
    stripePaymentIntentId: {
      type: DataTypes.STRING(255),
      unique: true,
      allowNull: true
    },
    buyShieldProtectionId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'buyshield',
        key: 'id'
      }
    },
    isLocalPickup: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    shipping: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: null,
      comment: 'Stores shipping details including tracking, carrier, label, and address information'
    },
    fees: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {
        platformFee: 0,
        processingFee: 0,
        buyShieldFee: 0,
        shippingFee: 0,
        taxAmount: 0
      }
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: null,
      comment: 'Stores transaction metadata like device info, IP address, and risk score'
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
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  });

  // Create indexes for efficient querying
  await queryInterface.addIndex('transactions', ['listingId'], {
    name: 'transactions_listing_idx'
  });

  await queryInterface.addIndex('transactions', ['buyerId'], {
    name: 'transactions_buyer_idx'
  });

  await queryInterface.addIndex('transactions', ['sellerId'], {
    name: 'transactions_seller_idx'
  });

  await queryInterface.addIndex('transactions', ['status'], {
    name: 'transactions_status_idx'
  });

  await queryInterface.addIndex('transactions', ['stripePaymentIntentId'], {
    name: 'transactions_payment_intent_idx'
  });

  await queryInterface.addIndex('transactions', ['completedAt'], {
    name: 'transactions_completed_idx',
    where: 'completed_at IS NOT NULL'
  });

  await queryInterface.addIndex('transactions', ['isLocalPickup', 'status'], {
    name: 'transactions_local_pickup_idx'
  });
};

// Revert migration
export const down = async (queryInterface: QueryInterface): Promise<void> => {
  // Drop indexes
  await queryInterface.removeIndex('transactions', 'transactions_listing_idx');
  await queryInterface.removeIndex('transactions', 'transactions_buyer_idx');
  await queryInterface.removeIndex('transactions', 'transactions_seller_idx');
  await queryInterface.removeIndex('transactions', 'transactions_status_idx');
  await queryInterface.removeIndex('transactions', 'transactions_payment_intent_idx');
  await queryInterface.removeIndex('transactions', 'transactions_completed_idx');
  await queryInterface.removeIndex('transactions', 'transactions_local_pickup_idx');

  // Drop table
  await queryInterface.dropTable('transactions');

  // Drop enum types
  await queryInterface.sequelize.query('DROP TYPE IF EXISTS transaction_status;');
  await queryInterface.sequelize.query('DROP TYPE IF EXISTS payment_method;');
};