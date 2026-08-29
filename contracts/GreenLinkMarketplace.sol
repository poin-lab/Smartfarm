// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract GreenLinkMarketplace is ERC1155Holder, AccessControl, Pausable, ReentrancyGuard {
    struct Listing { address seller; uint256 tokenId; uint256 quantity; uint256 unitPrice; bool active; }
    IERC1155 public immutable assets;
    address public feeRecipient;
    uint96 public feeBps;
    uint256 public nextListingId = 1;
    mapping(uint256 listingId => Listing) public listings;

    event Listed(uint256 indexed listingId, address indexed seller, uint256 indexed tokenId, uint256 quantity, uint256 unitPrice);
    event Purchased(uint256 indexed listingId, address indexed buyer, address indexed seller, uint256 tokenId, uint256 quantity, uint256 totalPrice);
    event Cancelled(uint256 indexed listingId, address indexed seller, uint256 returnedQuantity);

    constructor(IERC1155 assetContract, address admin, address initialFeeRecipient, uint96 initialFeeBps) {
        require(address(assetContract) != address(0) && admin != address(0) && initialFeeRecipient != address(0), "address=0");
        require(initialFeeBps <= 1000, "fee too high");
        assets = assetContract; feeRecipient = initialFeeRecipient; feeBps = initialFeeBps;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function createListing(uint256 tokenId, uint256 quantity, uint256 unitPrice) external whenNotPaused nonReentrant returns (uint256 id) {
        require(quantity > 0 && unitPrice > 0, "invalid listing");
        id = nextListingId++;
        listings[id] = Listing(msg.sender, tokenId, quantity, unitPrice, true);
        assets.safeTransferFrom(msg.sender, address(this), tokenId, quantity, "");
        emit Listed(id, msg.sender, tokenId, quantity, unitPrice);
    }

    function purchase(uint256 listingId, uint256 quantity) external payable whenNotPaused nonReentrant {
        Listing storage item = listings[listingId];
        require(item.active && quantity > 0 && quantity <= item.quantity, "invalid purchase");
        uint256 total = item.unitPrice * quantity;
        require(msg.value == total, "incorrect payment");
        item.quantity -= quantity; if (item.quantity == 0) item.active = false;
        uint256 fee = total * feeBps / 10_000;
        assets.safeTransferFrom(address(this), msg.sender, item.tokenId, quantity, "");
        (bool sellerPaid,) = payable(item.seller).call{value: total - fee}(""); require(sellerPaid, "seller payment failed");
        if (fee > 0) { (bool feePaid,) = payable(feeRecipient).call{value: fee}(""); require(feePaid, "fee payment failed"); }
        emit Purchased(listingId, msg.sender, item.seller, item.tokenId, quantity, total);
    }

    function cancel(uint256 listingId) external nonReentrant {
        Listing storage item = listings[listingId]; require(item.active && item.seller == msg.sender, "not seller");
        uint256 remaining = item.quantity; item.quantity = 0; item.active = false;
        assets.safeTransferFrom(address(this), msg.sender, item.tokenId, remaining, "");
        emit Cancelled(listingId, msg.sender, remaining);
    }

    function setFee(address recipient, uint96 basisPoints) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(recipient != address(0) && basisPoints <= 1000, "invalid fee"); feeRecipient = recipient; feeBps = basisPoints;
    }
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
    function supportsInterface(bytes4 interfaceId) public view override(ERC1155Holder, AccessControl) returns (bool) { return super.supportsInterface(interfaceId); }
}
