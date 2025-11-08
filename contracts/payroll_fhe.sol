pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract EncryptedPayroll is ZamaEthereumConfig {
    struct PayrollEntry {
        euint32 encryptedAmount;
        address encryptedRecipient;
        uint32 decryptedAmount;
        address decryptedRecipient;
        bool isVerified;
        uint256 paymentTimestamp;
        uint256 verificationTimestamp;
    }

    mapping(uint256 => PayrollEntry) public payrollRecords;
    uint256[] public payrollIds;

    address public owner;
    address public auditor;

    event PayrollCreated(uint256 indexed payrollId, address indexed creator);
    event PayrollVerified(uint256 indexed payrollId, uint32 amount, address recipient);
    event AuditorChanged(address indexed newAuditor);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can perform this action");
        _;
    }

    constructor() ZamaEthereumConfig() {
        owner = msg.sender;
        auditor = msg.sender;
    }

    function createPayrollEntry(
        externalEuint32 encryptedAmount,
        externalEuint32 encryptedRecipient,
        bytes calldata amountProof,
        bytes calldata recipientProof
    ) external onlyOwner {
        euint32 amount = FHE.fromExternal(encryptedAmount, amountProof);
        euint32 recipient = FHE.fromExternal(encryptedRecipient, recipientProof);

        require(FHE.isInitialized(amount), "Invalid encrypted amount");
        require(FHE.isInitialized(recipient), "Invalid encrypted recipient");

        uint256 payrollId = payrollIds.length;
        payrollRecords[payrollId] = PayrollEntry({
            encryptedAmount: amount,
            encryptedRecipient: recipient,
            decryptedAmount: 0,
            decryptedRecipient: address(0),
            isVerified: false,
            paymentTimestamp: block.timestamp,
            verificationTimestamp: 0
        });

        FHE.allowThis(amount);
        FHE.allowThis(recipient);
        FHE.makePubliclyDecryptable(amount);
        FHE.makePubliclyDecryptable(recipient);

        payrollIds.push(payrollId);
        emit PayrollCreated(payrollId, msg.sender);
    }

    function verifyPayroll(
        uint256 payrollId,
        bytes memory amountProof,
        bytes memory recipientProof
    ) external {
        require(msg.sender == auditor, "Only auditor can verify payroll");
        require(!payrollRecords[payrollId].isVerified, "Payroll already verified");

        PayrollEntry storage entry = payrollRecords[payrollId];

        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(entry.encryptedAmount);
        cts[1] = FHE.toBytes32(entry.encryptedRecipient);

        bytes memory decodedAmount = FHE.decode(entry.encryptedAmount, amountProof);
        bytes memory decodedRecipient = FHE.decode(entry.encryptedRecipient, recipientProof);

        FHE.checkSignatures(cts, abi.encode(decodedAmount, decodedRecipient), amountProof);

        entry.decryptedAmount = abi.decode(decodedAmount, (uint32));
        entry.decryptedRecipient = abi.decode(decodedRecipient, (address));
        entry.isVerified = true;
        entry.verificationTimestamp = block.timestamp;

        emit PayrollVerified(payrollId, entry.decryptedAmount, entry.decryptedRecipient);
    }

    function getPayrollEntry(uint256 payrollId) external view returns (
        uint32 decryptedAmount,
        address decryptedRecipient,
        bool isVerified,
        uint256 paymentTimestamp,
        uint256 verificationTimestamp
    ) {
        PayrollEntry storage entry = payrollRecords[payrollId];
        return (
            entry.decryptedAmount,
            entry.decryptedRecipient,
            entry.isVerified,
            entry.paymentTimestamp,
            entry.verificationTimestamp
        );
    }

    function getAllPayrollIds() external view returns (uint256[] memory) {
        return payrollIds;
    }

    function changeAuditor(address newAuditor) external onlyOwner {
        require(newAuditor != address(0), "Invalid auditor address");
        auditor = newAuditor;
        emit AuditorChanged(newAuditor);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner address");
        owner = newOwner;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


