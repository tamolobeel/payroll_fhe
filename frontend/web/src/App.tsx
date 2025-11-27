import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface PayrollData {
  id: string;
  employeeName: string;
  encryptedSalary: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [payrolls, setPayrolls] = useState<PayrollData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingPayroll, setCreatingPayroll] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newPayrollData, setNewPayrollData] = useState({ employeeName: "", salary: "", department: "" });
  const [selectedPayroll, setSelectedPayroll] = useState<PayrollData | null>(null);
  const [decryptedSalary, setDecryptedSalary] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const payrollsList: PayrollData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          payrollsList.push({
            id: businessId,
            employeeName: businessData.name,
            encryptedSalary: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setPayrolls(payrollsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createPayroll = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingPayroll(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating payroll with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const salaryValue = parseInt(newPayrollData.salary) || 0;
      const businessId = `payroll-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, salaryValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newPayrollData.employeeName,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newPayrollData.department) || 0,
        0,
        "Encrypted Payroll Entry"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Payroll created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewPayrollData({ employeeName: "", salary: "", department: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingPayroll(false); 
    }
  };

  const decryptSalary = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Salary decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available and working!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredPayrolls = payrolls.filter(payroll =>
    payroll.employeeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    payroll.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalPages = Math.ceil(filteredPayrolls.length / itemsPerPage);
  const currentPayrolls = filteredPayrolls.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const renderStats = () => {
    const totalPayrolls = payrolls.length;
    const verifiedPayrolls = payrolls.filter(p => p.isVerified).length;
    const totalEncryptedAmount = payrolls.reduce((sum, p) => sum + (p.isVerified ? p.decryptedValue : 0), 0);

    return (
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <h3>Total Payrolls</h3>
            <div className="stat-value">{totalPayrolls}</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">🔐</div>
          <div className="stat-content">
            <h3>Verified Data</h3>
            <div className="stat-value">{verifiedPayrolls}/{totalPayrolls}</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">⚡</div>
          <div className="stat-content">
            <h3>Total Encrypted</h3>
            <div className="stat-value">${totalEncryptedAmount.toLocaleString()}</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-number">1</div>
          <div className="step-content">
            <h4>Salary Encryption</h4>
            <p>Employee salaries encrypted with FHE technology</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">2</div>
          <div className="step-content">
            <h4>On-chain Storage</h4>
            <p>Encrypted data stored securely on blockchain</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">3</div>
          <div className="step-content">
            <h4>Zero-Knowledge Proof</h4>
            <p>Generate decryption proofs without revealing keys</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">4</div>
          <div className="step-content">
            <h4>Verification</h4>
            <p>On-chain validation of decryption proofs</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <h1>FHE Payroll System</h1>
            <p>Encrypted Salary Management</p>
          </div>
          <ConnectButton />
        </header>
        
        <div className="welcome-section">
          <div className="welcome-content">
            <div className="welcome-icon">🔐</div>
            <h2>Secure Payroll Management</h2>
            <p>FHE-powered encrypted salary system for DAOs</p>
            <div className="feature-grid">
              <div className="feature-item">
                <span>🔒</span>
                <p>Fully Encrypted</p>
              </div>
              <div className="feature-item">
                <span>⚡</span>
                <p>Instant Verification</p>
              </div>
              <div className="feature-item">
                <span>🌐</span>
                <p>DAO Compatible</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Initializing FHE System...</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-main">
          <div className="logo-section">
            <h1>FHE Payroll System</h1>
            <span className="tag">Encrypted</span>
          </div>
          
          <div className="header-actions">
            <button onClick={checkAvailability} className="availability-btn">
              Check Availability
            </button>
            <button onClick={() => setShowCreateModal(true)} className="create-btn">
              + Add Payroll
            </button>
            <ConnectButton />
          </div>
        </div>
      </header>

      <main className="main-content">
        <section className="dashboard-section">
          <h2>Payroll Dashboard</h2>
          {renderStats()}
          
          <div className="fhe-info-panel">
            <h3>FHE Encryption Process</h3>
            {renderFHEProcess()}
          </div>
        </section>

        <section className="payroll-section">
          <div className="section-header">
            <h2>Employee Payrolls</h2>
            <div className="controls">
              <div className="search-box">
                <input
                  type="text"
                  placeholder="Search employees..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <button onClick={loadData} disabled={isRefreshing} className="refresh-btn">
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="payroll-list">
            {currentPayrolls.length === 0 ? (
              <div className="empty-state">
                <p>No payroll records found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Create First Payroll
                </button>
              </div>
            ) : (
              currentPayrolls.map((payroll, index) => (
                <div key={index} className="payroll-item">
                  <div className="payroll-info">
                    <div className="employee-name">{payroll.employeeName}</div>
                    <div className="payroll-meta">
                      <span>Dept: {payroll.publicValue1}</span>
                      <span>Date: {new Date(payroll.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                    <div className="salary-status">
                      {payroll.isVerified ? (
                        <span className="verified">Verified: ${payroll.decryptedValue}</span>
                      ) : (
                        <span className="encrypted">🔒 Encrypted</span>
                      )}
                    </div>
                  </div>
                  <div className="payroll-actions">
                    <button
                      onClick={() => setSelectedPayroll(payroll)}
                      className="view-btn"
                    >
                      View Details
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          )}
        </section>
      </main>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Add New Payroll</h3>
              <button onClick={() => setShowCreateModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Employee Name</label>
                <input
                  type="text"
                  value={newPayrollData.employeeName}
                  onChange={(e) => setNewPayrollData({...newPayrollData, employeeName: e.target.value})}
                  placeholder="Enter employee name"
                />
              </div>
              <div className="form-group">
                <label>Salary Amount (Integer)</label>
                <input
                  type="number"
                  value={newPayrollData.salary}
                  onChange={(e) => setNewPayrollData({...newPayrollData, salary: e.target.value})}
                  placeholder="Enter salary amount"
                />
                <small>FHE Encrypted Integer</small>
              </div>
              <div className="form-group">
                <label>Department Code</label>
                <input
                  type="number"
                  value={newPayrollData.department}
                  onChange={(e) => setNewPayrollData({...newPayrollData, department: e.target.value})}
                  placeholder="Enter department code"
                />
                <small>Public Data</small>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button
                onClick={createPayroll}
                disabled={creatingPayroll || isEncrypting}
                className="primary"
              >
                {creatingPayroll ? "Creating..." : "Create Payroll"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedPayroll && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Payroll Details</h3>
              <button onClick={() => setSelectedPayroll(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="detail-item">
                <label>Employee:</label>
                <span>{selectedPayroll.employeeName}</span>
              </div>
              <div className="detail-item">
                <label>Department:</label>
                <span>{selectedPayroll.publicValue1}</span>
              </div>
              <div className="detail-item">
                <label>Salary Status:</label>
                <span className={selectedPayroll.isVerified ? "verified" : "encrypted"}>
                  {selectedPayroll.isVerified ? `$${selectedPayroll.decryptedValue} (Verified)` : "🔒 Encrypted"}
                </span>
              </div>
              <div className="detail-item">
                <label>Created:</label>
                <span>{new Date(selectedPayroll.timestamp * 1000).toLocaleString()}</span>
              </div>
              
              <div className="decrypt-section">
                <button
                  onClick={async () => {
                    const salary = await decryptSalary(selectedPayroll.id);
                    if (salary !== null) {
                      setDecryptedSalary(salary);
                    }
                  }}
                  disabled={isDecrypting || selectedPayroll.isVerified}
                  className="decrypt-btn"
                >
                  {isDecrypting ? "Decrypting..." : selectedPayroll.isVerified ? "Already Verified" : "Decrypt Salary"}
                </button>
                {decryptedSalary !== null && !selectedPayroll.isVerified && (
                  <div className="decrypted-result">
                    Decrypted Salary: ${decryptedSalary}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className={`toast ${transactionStatus.status}`}>
          {transactionStatus.message}
        </div>
      )}
    </div>
  );
};

export default App;