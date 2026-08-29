// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice Utility/participation assets for GREEN LINK smart-farm containers.
/// @dev These tokens do not encode equity, dividends, profit rights, or ownership of a farm.
contract GreenLinkAssets is ERC1155, ERC1155Supply, AccessControl, Pausable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant ANCHOR_ROLE = keccak256("ANCHOR_ROLE");

    mapping(uint256 tokenId => bytes32 containerKey) public containerOf;
    mapping(bytes32 root => bool anchored) public sensorRoots;

    event ContainerTokenIssued(bytes32 indexed containerKey, uint256 indexed tokenId, uint256 supply, address indexed recipient);
    event SensorBatchAnchored(bytes32 indexed containerKey, bytes32 indexed merkleRoot, uint64 fromTimestamp, uint64 toTimestamp, uint32 readingCount);

    constructor(string memory metadataUri, address admin) ERC1155(metadataUri) {
        require(admin != address(0), "admin=0");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(ANCHOR_ROLE, admin);
    }

    function issueContainerToken(bytes32 containerKey, uint256 tokenId, uint256 supply, address recipient)
        external onlyRole(MINTER_ROLE)
    {
        require(containerKey != bytes32(0), "container=0");
        require(recipient != address(0), "recipient=0");
        require(supply > 0 && totalSupply(tokenId) == 0, "invalid supply");
        containerOf[tokenId] = containerKey;
        _mint(recipient, tokenId, supply, "");
        emit ContainerTokenIssued(containerKey, tokenId, supply, recipient);
    }

    function anchorSensorBatch(bytes32 containerKey, bytes32 merkleRoot, uint64 fromTimestamp, uint64 toTimestamp, uint32 readingCount)
        external onlyRole(ANCHOR_ROLE)
    {
        require(containerKey != bytes32(0) && merkleRoot != bytes32(0), "empty anchor");
        require(fromTimestamp <= toTimestamp && readingCount > 0, "invalid range");
        require(!sensorRoots[merkleRoot], "already anchored");
        sensorRoots[merkleRoot] = true;
        emit SensorBatchAnchored(containerKey, merkleRoot, fromTimestamp, toTimestamp, readingCount);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal override(ERC1155, ERC1155Supply) whenNotPaused
    {
        super._update(from, to, ids, values);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
