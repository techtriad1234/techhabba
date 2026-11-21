// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IntentGuard
/// @notice A guarded execution vault for transactions approved against an off-chain
///         human-readable manifest. Only allowlisted target/selector pairs can execute.
/// @dev The manifest hash is an attestation by the client, not an on-chain ABI proof.
///      Assets are protected only when held by / routed through this contract.
contract IntentGuard {
    address public immutable owner;
    uint256 public immutable maxCallValue;
    uint256 public nextNonce;
    bool private entered;

    mapping(address => mapping(bytes4 => bool)) public isAllowed;

    struct Intent {
        address target;
        uint256 value;
        bytes32 calldataHash;
        bytes32 manifestHash;
        uint256 nonce;
        uint64 deadline;
        bool exists;
    }

    mapping(bytes32 => Intent) public intents;

    event PolicyConfigured(address indexed target, bytes4 indexed selector, bool allowed);
    event IntentCommitted(
        bytes32 indexed intentId,
        address indexed owner,
        address indexed target,
        uint256 value,
        bytes32 calldataHash,
        bytes32 manifestHash,
        uint256 nonce,
        uint64 deadline
    );
    event IntentExecuted(bytes32 indexed intentId, address indexed target, uint256 value, bytes result);

    error NotOwner();
    error InvalidConfiguration();
    error TargetNotAllowed();
    error DangerousApprovalBlocked();
    error ValueLimitExceeded();
    error InvalidDeadline();
    error IntentNotFound();
    error IntentExpired();
    error IntentMismatch();
    error ReentrantCall();
    error TargetCallFailed(bytes reason);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (entered) revert ReentrantCall();
        entered = true;
        _;
        entered = false;
    }

    constructor(
        address[] memory targets,
        bytes4[] memory selectors,
        uint256 _maxCallValue
    ) {
        if (targets.length == 0 || targets.length != selectors.length) revert InvalidConfiguration();
        owner = msg.sender;
        maxCallValue = _maxCallValue;
        for (uint256 i; i < targets.length; ++i) {
            if (targets[i] == address(0) || selectors[i] == bytes4(0)) revert InvalidConfiguration();
            isAllowed[targets[i]][selectors[i]] = true;
            emit PolicyConfigured(targets[i], selectors[i], true);
        }
    }

    receive() external payable {}

    /// @notice Commit to the exact target, value, calldata and reviewed manifest.
    /// @dev The caller must separately ensure the manifest accurately describes calldata.
    function commitIntent(
        address target,
        uint256 value,
        bytes calldata callData,
        bytes32 manifestHash,
        uint64 deadline
    ) external onlyOwner returns (bytes32 intentId) {
        if (callData.length < 4) revert TargetNotAllowed();
        if (_isDangerousApproval(_selector(callData))) revert DangerousApprovalBlocked();
        if (!isAllowed[target][_selector(callData)]) revert TargetNotAllowed();
        if (value > maxCallValue) revert ValueLimitExceeded();
        if (deadline <= block.timestamp || deadline > block.timestamp + 1 days) revert InvalidDeadline();

        uint256 nonce = nextNonce++;
        bytes32 callHash = keccak256(callData);
        intentId = keccak256(abi.encode(
            block.chainid, address(this), msg.sender, target, value,
            callHash, manifestHash, nonce, deadline
        ));

        intents[intentId] = Intent({
            target: target,
            value: value,
            calldataHash: callHash,
            manifestHash: manifestHash,
            nonce: nonce,
            deadline: deadline,
            exists: true
        });

        emit IntentCommitted(intentId, msg.sender, target, value, callHash, manifestHash, nonce, deadline);
    }

    /// @notice Execute only the exact calldata committed to by the owner.
    function executeIntent(bytes32 intentId, bytes calldata callData)
        external
        onlyOwner
        nonReentrant
        returns (bytes memory result)
    {
        Intent memory intent = intents[intentId];
        if (!intent.exists) revert IntentNotFound();
        if (block.timestamp > intent.deadline) revert IntentExpired();
        if (keccak256(callData) != intent.calldataHash) revert IntentMismatch();
        if (_isDangerousApproval(_selector(callData))) revert DangerousApprovalBlocked();
        if (!isAllowed[intent.target][_selector(callData)]) revert TargetNotAllowed();
        if (intent.value > maxCallValue) revert ValueLimitExceeded();

        // Effects before interaction; a failed target call reverts the whole transaction.
        delete intents[intentId];
        (bool ok, bytes memory returned) = intent.target.call{value: intent.value}(callData);
        if (!ok) revert TargetCallFailed(returned);

        emit IntentExecuted(intentId, intent.target, intent.value, returned);
        return returned;
    }

    /// @dev Prototype default-deny for common token/NFT approval entry points.
    ///      This is intentionally conservative; token-specific limited approvals are not yet supported.
    function _isDangerousApproval(bytes4 selector) private pure returns (bool) {
        return selector == bytes4(keccak256("approve(address,uint256)"))
            || selector == bytes4(keccak256("increaseAllowance(address,uint256)"))
            || selector == bytes4(keccak256("setApprovalForAll(address,bool)"))
            || selector == bytes4(keccak256("permit(address,address,uint256,uint256,uint8,bytes32,bytes32)"))
            || selector == bytes4(keccak256("permit(address,address,uint256,uint256,bool,uint8,bytes32,bytes32)"));
    }

    function _selector(bytes calldata data) private pure returns (bytes4 selector) {
        assembly { selector := calldataload(data.offset) }
    }
}
