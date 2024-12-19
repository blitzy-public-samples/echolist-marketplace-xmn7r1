/**
 * @file Message model definition for the EchoList platform
 * @description Sequelize model for handling real-time messaging with AI processing,
 * transaction controls, and content moderation capabilities
 */

import { Model, DataTypes } from 'sequelize'; // ^6.32.0
import { IMessage, IMessageAIMetadata, MessageType, MessageStatus, AttachmentType } from '../../interfaces/message.interface';

// Constants for model configuration
const MESSAGE_TABLE_NAME = 'messages';
const MESSAGE_CONTENT_MAX_LENGTH = 5000;
const MESSAGE_BATCH_SIZE = 100;

/**
 * Message model class extending Sequelize Model with enhanced real-time
 * tracking and AI processing capabilities
 */
export default class Message extends Model implements IMessage {
    public id!: string;
    public senderId!: string;
    public receiverId!: string;
    public listingId!: string;
    public transactionId!: string | null;
    public content!: string;
    public type!: MessageType;
    public status!: MessageStatus;
    public aiProcessed!: boolean;
    public aiMetadata!: IMessageAIMetadata;
    public attachments!: any[];
    public offerAmount!: number | null;
    public systemMetadata!: Record<string, any>;
    public deliveredAt!: Date | null;
    public readAt!: Date | null;
    public createdAt!: Date;
    public updatedAt!: Date;
    public deletedAt!: Date | null;

    /**
     * Initialize the Message model with Sequelize
     * @param sequelize Sequelize instance
     */
    public static initialize(sequelize: any): void {
        Message.init(
            {
                id: {
                    type: DataTypes.UUID,
                    defaultValue: DataTypes.UUIDV4,
                    primaryKey: true,
                },
                senderId: {
                    type: DataTypes.UUID,
                    allowNull: false,
                    references: {
                        model: 'users',
                        key: 'id',
                    },
                },
                receiverId: {
                    type: DataTypes.UUID,
                    allowNull: false,
                    references: {
                        model: 'users',
                        key: 'id',
                    },
                },
                listingId: {
                    type: DataTypes.UUID,
                    allowNull: true,
                    references: {
                        model: 'listings',
                        key: 'id',
                    },
                },
                transactionId: {
                    type: DataTypes.UUID,
                    allowNull: true,
                    references: {
                        model: 'transactions',
                        key: 'id',
                    },
                },
                content: {
                    type: DataTypes.TEXT,
                    allowNull: false,
                    validate: {
                        len: [1, MESSAGE_CONTENT_MAX_LENGTH],
                    },
                },
                type: {
                    type: DataTypes.ENUM(...Object.values(MessageType)),
                    allowNull: false,
                },
                status: {
                    type: DataTypes.ENUM(...Object.values(MessageStatus)),
                    allowNull: false,
                    defaultValue: MessageStatus.SENT,
                },
                aiProcessed: {
                    type: DataTypes.BOOLEAN,
                    allowNull: false,
                    defaultValue: false,
                },
                aiMetadata: {
                    type: DataTypes.JSONB,
                    allowNull: true,
                    defaultValue: null,
                },
                attachments: {
                    type: DataTypes.JSONB,
                    allowNull: false,
                    defaultValue: [],
                    validate: {
                        isValidAttachments(value: any[]) {
                            if (!Array.isArray(value)) {
                                throw new Error('Attachments must be an array');
                            }
                            value.forEach(attachment => {
                                if (!attachment.type || !Object.values(AttachmentType).includes(attachment.type)) {
                                    throw new Error('Invalid attachment type');
                                }
                            });
                        },
                    },
                },
                offerAmount: {
                    type: DataTypes.DECIMAL(10, 2),
                    allowNull: true,
                },
                systemMetadata: {
                    type: DataTypes.JSONB,
                    allowNull: false,
                    defaultValue: {},
                },
                deliveredAt: {
                    type: DataTypes.DATE,
                    allowNull: true,
                },
                readAt: {
                    type: DataTypes.DATE,
                    allowNull: true,
                },
            },
            {
                sequelize,
                tableName: MESSAGE_TABLE_NAME,
                paranoid: true, // Enable soft deletes
                indexes: [
                    {
                        fields: ['senderId', 'receiverId'],
                        name: 'messages_sender_receiver_idx',
                    },
                    {
                        fields: ['listingId'],
                        name: 'messages_listing_idx',
                    },
                    {
                        fields: ['transactionId'],
                        name: 'messages_transaction_idx',
                    },
                    {
                        fields: ['type', 'status'],
                        name: 'messages_type_status_idx',
                    },
                    {
                        fields: ['createdAt'],
                        name: 'messages_created_at_idx',
                    },
                ],
            }
        );
    }

    /**
     * Establish model associations with enhanced cascade rules and constraints
     * @param models Object containing all models
     */
    public static associate(models: any): void {
        // Sender association
        Message.belongsTo(models.User, {
            foreignKey: 'senderId',
            as: 'sender',
            onDelete: 'CASCADE',
        });

        // Receiver association
        Message.belongsTo(models.User, {
            foreignKey: 'receiverId',
            as: 'receiver',
            onDelete: 'CASCADE',
        });

        // Listing association
        Message.belongsTo(models.Listing, {
            foreignKey: 'listingId',
            as: 'listing',
            onDelete: 'SET NULL',
        });

        // Transaction association
        Message.belongsTo(models.Transaction, {
            foreignKey: 'transactionId',
            as: 'transaction',
            onDelete: 'SET NULL',
        });
    }
}