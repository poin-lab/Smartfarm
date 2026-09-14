package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

type SmartContract struct {
	contractapi.Contract
}

// ============================================================================
// 1. Models
// ============================================================================

type ChaincodeInputWrapper struct {
	Fields ExecutionInput `json:"fields"`
}

// One trade execution from smartfarm's token_executions table.
type ExecutionInput struct {
	ExecutionID string `json:"execution_id"`
	TokenID     string `json:"token_id"`
	BuyerID     string `json:"buyer_id"`
	SellerID    string `json:"seller_id"`
	Quantity    int64  `json:"quantity"`
	UnitPrice   int64  `json:"unit_price"`
	ExecutedAt  string `json:"executed_at"`
	CerHash     string `json:"cer_hash"` // sha256 over the fields above, computed by the caller
}

// Item as stored on the ledger (same fields, integrity already verified).
type BatchItem struct {
	ExecutionID string `json:"execution_id"`
	TokenID     string `json:"token_id"`
	BuyerID     string `json:"buyer_id"`
	SellerID    string `json:"seller_id"`
	Quantity    int64  `json:"quantity"`
	UnitPrice   int64  `json:"unit_price"`
	ExecutedAt  string `json:"executed_at"`
	CerHash     string `json:"cer_hash"`
}

// One anchored batch of trade executions.
type TxBatchRecord struct {
	DocType     string      `json:"docType"` // "TxBatch"
	MerkleRoot  string      `json:"merkle_root"`
	Count       int         `json:"count"`
	Items       []BatchItem `json:"items"`
	CreatedAtMs int64       `json:"created_at_ms"`
	TxID        string      `json:"tx_id"`
}

type PaginatedTxBatchResult struct {
	Records  []*TxBatchRecord `json:"records"`
	Bookmark string           `json:"bookmark"`
}

const docTypeTxBatch = "TxBatch"

// ============================================================================
// 2. Logic: Verification & Merkle Root
// ============================================================================

// Recomputes the integrity hash and compares it against what the caller
// (smartfarm's Node server) sent, so the ledger only accepts executions whose
// fields haven't been tampered with in transit.
func verifyIntegrity(in ExecutionInput) error {
	verifyMap := map[string]interface{}{
		"execution_id": in.ExecutionID,
		"token_id":     in.TokenID,
		"buyer_id":     in.BuyerID,
		"seller_id":    in.SellerID,
		"quantity":     in.Quantity,
		"unit_price":   in.UnitPrice,
		"executed_at":  in.ExecutedAt,
	}

	jsonBytes, err := json.Marshal(verifyMap)
	if err != nil {
		return fmt.Errorf("JSON marshal failed: %v", err)
	}

	hash := sha256.Sum256(jsonBytes)
	calculatedHash := hex.EncodeToString(hash[:])

	if strings.ToLower(calculatedHash) != strings.ToLower(in.CerHash) {
		return fmt.Errorf("integrity check failed for execution %s: hash mismatch", in.ExecutionID)
	}
	return nil
}

// Standard binary Merkle tree over sha256(item JSON), duplicating the last
// hash on odd levels. Anyone holding a batch's items can recompute this and
// confirm it matches what's on the ledger.
func calculateMerkleRoot(items []BatchItem) string {
	if len(items) == 0 {
		return ""
	}
	var hashes [][]byte
	for _, item := range items {
		b, _ := json.Marshal(item)
		h := sha256.Sum256(b)
		hashes = append(hashes, h[:])
	}

	for len(hashes) > 1 {
		if len(hashes)%2 != 0 {
			hashes = append(hashes, hashes[len(hashes)-1])
		}
		var nextLevel [][]byte
		for i := 0; i < len(hashes); i += 2 {
			combined := append(hashes[i], hashes[i+1]...)
			h := sha256.Sum256(combined)
			nextLevel = append(nextLevel, h[:])
		}
		hashes = nextLevel
	}
	return hex.EncodeToString(hashes[0])
}

// ============================================================================
// 3. Main Logic: CreateBatch
// ============================================================================

// CreateBatch anchors a batch of trade executions (any size >= 1) as a single
// Merkle-rooted ledger entry. Idempotent: re-submitting the same batch (same
// merkle root) returns the existing record instead of erroring.
func (s *SmartContract) CreateBatch(ctx contractapi.TransactionContextInterface, itemsJSON string) (string, error) {
	var wrappers []ChaincodeInputWrapper
	if err := json.Unmarshal([]byte(itemsJSON), &wrappers); err != nil {
		var plain []ExecutionInput
		if err2 := json.Unmarshal([]byte(itemsJSON), &plain); err2 == nil {
			wrappers = make([]ChaincodeInputWrapper, len(plain))
			for i, p := range plain {
				wrappers[i].Fields = p
			}
		} else {
			return "", fmt.Errorf("input parsing failed: %v", err)
		}
	}

	if len(wrappers) == 0 {
		return "", fmt.Errorf("batch must contain at least one execution")
	}

	finalItems := make([]BatchItem, 0, len(wrappers))
	for i, w := range wrappers {
		input := w.Fields
		if input.ExecutionID == "" || input.CerHash == "" {
			return "", fmt.Errorf("missing required fields at index %d", i)
		}
		if err := verifyIntegrity(input); err != nil {
			return "", fmt.Errorf("integrity check failed at index %d: %v", i, err)
		}
		finalItems = append(finalItems, BatchItem{
			ExecutionID: input.ExecutionID,
			TokenID:     input.TokenID,
			BuyerID:     input.BuyerID,
			SellerID:    input.SellerID,
			Quantity:    input.Quantity,
			UnitPrice:   input.UnitPrice,
			ExecutedAt:  input.ExecutedAt,
			CerHash:     input.CerHash,
		})
	}

	txTimestamp, _ := ctx.GetStub().GetTxTimestamp()
	txID := ctx.GetStub().GetTxID()
	merkleRoot := calculateMerkleRoot(finalItems)

	record := TxBatchRecord{
		DocType:     docTypeTxBatch,
		MerkleRoot:  merkleRoot,
		Count:       len(finalItems),
		Items:       finalItems,
		CreatedAtMs: txTimestamp.Seconds*1000 + int64(txTimestamp.Nanos/1000000),
		TxID:        txID,
	}

	recordJSON, _ := json.Marshal(record)
	key := "txbatch:" + merkleRoot

	if existing, _ := ctx.GetStub().GetState(key); existing != nil {
		return string(existing), nil
	}

	if err := ctx.GetStub().PutState(key, recordJSON); err != nil {
		return "", fmt.Errorf("PutState failed: %v", err)
	}

	return string(recordJSON), nil
}

// ============================================================================
// Queries
// ============================================================================

func (s *SmartContract) GetBatch(ctx contractapi.TransactionContextInterface, merkleRoot string) (*TxBatchRecord, error) {
	bytes, err := ctx.GetStub().GetState("txbatch:" + merkleRoot)
	if err != nil {
		return nil, err
	}
	if bytes == nil {
		return nil, fmt.Errorf("batch not found")
	}
	var rec TxBatchRecord
	json.Unmarshal(bytes, &rec)
	return &rec, nil
}

func (s *SmartContract) QueryBatchesWithPagination(ctx contractapi.TransactionContextInterface, pageSize int, bookmark string) (*PaginatedTxBatchResult, error) {
	queryString := `{"selector":{"docType":"TxBatch"}, "sort": [{"created_at_ms": "desc"}]}`
	resultsIterator, responseMetadata, err := ctx.GetStub().GetQueryResultWithPagination(queryString, int32(pageSize), bookmark)
	if err != nil {
		return nil, err
	}
	defer resultsIterator.Close()

	var records []*TxBatchRecord
	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, err
		}
		var rec TxBatchRecord
		json.Unmarshal(queryResponse.Value, &rec)
		records = append(records, &rec)
	}
	return &PaginatedTxBatchResult{Records: records, Bookmark: responseMetadata.Bookmark}, nil
}

func (s *SmartContract) QueryBatchesByDate(ctx contractapi.TransactionContextInterface, startMs int64, endMs int64, pageSize int, bookmark string) (*PaginatedTxBatchResult, error) {
	queryString := fmt.Sprintf(`{
		"selector": {
			"docType": "TxBatch",
			"created_at_ms": {
				"$gte": %d,
				"$lte": %d
			}
		},
		"sort": [{"created_at_ms": "desc"}]
	}`, startMs, endMs)

	resultsIterator, responseMetadata, err := ctx.GetStub().GetQueryResultWithPagination(queryString, int32(pageSize), bookmark)
	if err != nil {
		return nil, err
	}
	defer resultsIterator.Close()

	var records []*TxBatchRecord
	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, err
		}
		var rec TxBatchRecord
		json.Unmarshal(queryResponse.Value, &rec)
		records = append(records, &rec)
	}

	return &PaginatedTxBatchResult{
		Records:  records,
		Bookmark: responseMetadata.Bookmark,
	}, nil
}

func main() {
	chaincode, err := contractapi.NewChaincode(&SmartContract{})
	if err != nil {
		fmt.Printf("Error creating chaincode: %s", err.Error())
		return
	}
	if err := chaincode.Start(); err != nil {
		fmt.Printf("Error starting chaincode: %s", err.Error())
	}
}
