/**
 * @file Database migration for messages table
 * @description Creates the messages table with comprehensive support for real-time messaging,
 * AI processing, and transaction-related communications
 * @version 1.0.0
 */

import { QueryInterface, DataTypes } from 'sequelize';
import { MessageType, MessageStatus } from '../../interfaces/message.interface';

export default {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    // Create messages table with comprehensive schema
    await queryInterface.createTable('messages', {
      // Primary identifier
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false,
        comment: 'Unique identifier for the message'
      },

      // Relationship fields
      senderId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Foreign key reference to message sender'
      },

      receiverId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Foreign key reference to message recipient'
      },

      listingId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'listings',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Optional reference to associated listing'
      },

      // Message content and metadata
      content: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'Main message content'
      },

      type: {
        type: DataTypes.ENUM(...Object.values(MessageType)),
        allowNull: false,
        defaultValue: MessageType.TEXT,
        comment: 'Type of message (TEXT, OFFER, TRANSACTION, etc.)'
      },

      status: {
        type: DataTypes.ENUM(...Object.values(MessageStatus)),
        allowNull: false,
        defaultValue: MessageStatus.SENT,
        comment: 'Current message delivery status'
      },

      // AI processing fields
      aiProcessed: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Indicates if message has been processed by AI'
      },

      aiMetadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Structured data for AI processing results'
      },

      // Attachments and additional data
      attachments: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Array of message attachments and metadata'
      },

      transactionId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Optional reference to associated transaction'
      },

      offerAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        comment: 'Amount for offer-type messages'
      },

      systemMetadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Additional system-level metadata'
      },

      // Delivery tracking timestamps
      deliveredAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Timestamp of message delivery'
      },

      readAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Timestamp when message was read'
      },

      // Standard timestamps
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: 'Record creation timestamp'
      },

      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: 'Record last update timestamp'
      }
    });

    // Create optimized indexes for common queries
    await queryInterface.addIndex('messages', ['senderId', 'receiverId'], {
      name: 'messages_sender_receiver_idx',
      comment: 'Optimize conversation queries'
    });

    await queryInterface.addIndex('messages', ['listingId'], {
      name: 'messages_listing_idx',
      comment: 'Optimize listing-related message queries'
    });

    await queryInterface.addIndex('messages', ['createdAt'], {
      name: 'messages_created_at_idx',
      comment: 'Support chronological queries and pagination'
    });

    await queryInterface.addIndex('messages', ['type', 'status'], {
      name: 'messages_type_status_idx',
      comment: 'Optimize filtering by message type and status'
    });

    await queryInterface.addIndex('messages', ['transactionId'], {
      name: 'messages_transaction_idx',
      comment: 'Optimize transaction-related message queries'
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    // Drop indexes first
    await queryInterface.removeIndex('messages', 'messages_sender_receiver_idx');
    await queryInterface.removeIndex('messages', 'messages_listing_idx');
    await queryInterface.removeIndex('messages', 'messages_created_at_idx');
    await queryInterface.removeIndex('messages', 'messages_type_status_idx');
    await queryInterface.removeIndex('messages', 'messages_transaction_idx');

    // Drop the messages table
    await queryInterface.dropTable('messages');
  }
};