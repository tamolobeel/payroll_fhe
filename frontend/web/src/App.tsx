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
  publicHours: number;
  publicPerformance: number;
  description: string;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface PayrollStats {
  totalPayments: number;
  verifiedPayments: number;
  avgPerformance: number;
  totalHours: number;
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
  const [newPayrollData, setNewPayrollData] = useState({ 
    employeeName: "", 
    salary: "", 
    hours: "", 
    performance: "" 
  });
  const [selectedPayroll, setSelectedPayroll] = useState<PayrollData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;
  const [operationHistory, setOperationHistory] = useState<string[]>([]);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

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

  const addToHistory = (operation: string) => {
    setOperationHistory(prev => [
      `${new Date().toLocaleTimeString()}: ${operation}`,
      ...prev.slice(0, 9)
    ]);
  };

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
            publicHours: Number(businessData.publicValue1) || 0,
            publicPerformance: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setPayrolls(payrollsList);
      addToHistory(`Loaded ${payrollsList.length} payroll records`);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available and ready" });
        addToHistory("Checked contract availability - Ready");
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
    }
    setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
  };

  const createPayroll = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingPayroll(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted payroll with Zama FHE..." });
    
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
        parseInt(newPayrollData.hours) || 0,
        parseInt(newPayrollData.performance) || 0,
        "Encrypted Payroll Record"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Payroll created successfully!" });
      addToHistory(`Created payroll for ${newPayrollData.employeeName}`);
      
      await loadData();
      setShowCreateModal(false);
      setNewPayrollData({ employeeName: "", salary: "", hours: "", performance: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
    } finally { 
      setCreatingPayroll(false); 
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const decryptSalary = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Salary already verified on-chain" });
        addToHistory(`Viewed verified salary for record ${businessId}`);
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
      addToHistory(`Decrypted and verified salary for record ${businessId}`);
      
      setTransactionStatus({ visible: true, status: "success", message: "Salary decrypted and verified successfully!" });
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Salary is already verified on-chain" });
        await loadData();
        return null;
      }
      
      setTransactionStatus({ status: "error", message: "Decryption failed: " + (e.message || "Unknown error"), visible: true });
      return null; 
    } finally {
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const getPayrollStats = (): PayrollStats => {
    const totalPayments = payrolls.length;
    const verifiedPayments = payrolls.filter(p => p.isVerified).length;
    const avgPerformance = payrolls.length > 0 
      ? payrolls.reduce((sum, p) => sum + p.publicPerformance, 0) / payrolls.length 
      : 0;
    const totalHours = payrolls.reduce((sum, p) => sum + p.publicHours, 0);

    return { totalPayments, verifiedPayments, avgPerformance, totalHours };
  };

  const filteredPayrolls = payrolls.filter(payroll =>
    payroll.employeeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    payroll.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const paginatedPayrolls = filteredPayrolls.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredPayrolls.length / itemsPerPage);

  const renderStatsDashboard = () => {
    const stats = getPayrollStats();
    
    return (
      <div className="stats-grid">
        <div className="stat-card gold-card">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <h3>Total Payments</h3>
            <div className="stat-value">{stats.totalPayments}</div>
            <div className="stat-trend">Encrypted Records</div>
          </div>
        </div>
        
        <div className="stat-card silver-card">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <h3>Verified</h3>
            <div className="stat-value">{stats.verifiedPayments}/{stats.totalPayments}</div>
            <div className="stat-trend">On-chain Verified</div>
          </div>
        </div>
        
        <div className="stat-card bronze-card">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <h3>Avg Performance</h3>
            <div className="stat-value">{stats.avgPerformance.toFixed(1)}/10</div>
            <div className="stat-trend">Public Data</div>
          </div>
        </div>
        
        <div className="stat-card copper-card">
          <div className="stat-icon">⏱️</div>
          <div className="stat-content">
            <h3>Total Hours</h3>
            <div className="stat-value">{stats.totalHours}</div>
            <div className="stat-trend">Work Hours</div>
          </div>
        </div>
      </div>
    );
  };

  const renderPerformanceChart = () => {
    const performanceData = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    payrolls.forEach(p => {
      if (p.publicPerformance >= 1 && p.publicPerformance <= 10) {
        performanceData[p.publicPerformance - 1]++;
      }
    });

    const maxCount = Math.max(...performanceData);

    return (
      <div className="performance-chart">
        <h3>Performance Distribution</h3>
        <div className="chart-bars">
          {performanceData.map((count, index) => (
            <div key={index} className="chart-bar">
              <div 
                className="bar-fill"
                style={{ height: maxCount ? `${(count / maxCount) * 100}%` : '0%' }}
              >
                <span className="bar-value">{count}</span>
              </div>
              <div className="bar-label">{index + 1}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header metal-header">
          <div className="logo">
            <h1>🔐 FHE Payroll System</h1>
            <span>Encrypted Salary Management</span>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt metal-bg">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Connect Your Wallet to Access Encrypted Payroll</h2>
            <p>Secure, private salary management powered by Zama FHE encryption</p>
            <div className="feature-grid">
              <div className="feature-item">
                <span>🔒</span>
                <h4>Encrypted Salaries</h4>
                <p>Salary amounts fully encrypted on-chain</p>
              </div>
              <div className="feature-item">
                <span>👥</span>
                <h4>DAO Privacy</h4>
                <p>Protect employee privacy while ensuring transparency</p>
              </div>
              <div className="feature-item">
                <span>📊</span>
                <h4>Audit Ready</h4>
                <p>Compliance-friendly verification system</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen metal-bg">
        <div className="fhe-spinner metal-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing payroll data with Zama FHE</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen metal-bg">
      <div className="fhe-spinner metal-spinner"></div>
      <p>Loading encrypted payroll system...</p>
    </div>
  );

  return (
    <div className="app-container metal-theme">
      <header className="app-header metal-header">
        <div className="logo">
          <h1>🔐 FHE Payroll System</h1>
          <span>Metal-Secure Salary Management</span>
        </div>
        
        <div className="header-actions">
          <button onClick={testAvailability} className="test-btn metal-btn">
            Test Connection
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn metal-btn primary"
          >
            + New Payroll
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-dashboard">
        <div className="dashboard-section">
          <h2>Payroll Overview</h2>
          {renderStatsDashboard()}
          
          <div className="charts-section">
            <div className="chart-container metal-panel">
              {renderPerformanceChart()}
            </div>
          </div>
        </div>
        
        <div className="payrolls-section">
          <div className="section-header">
            <h2>Payroll Records</h2>
            <div className="controls-row">
              <div className="search-box">
                <input
                  type="text"
                  placeholder="Search employees..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input metal-input"
                />
              </div>
              <button onClick={loadData} className="refresh-btn metal-btn" disabled={isRefreshing}>
                {isRefreshing ? "🔄" : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="payrolls-list">
            {paginatedPayrolls.length === 0 ? (
              <div className="no-records metal-panel">
                <p>No payroll records found</p>
                <button className="create-btn metal-btn" onClick={() => setShowCreateModal(true)}>
                  Create First Record
                </button>
              </div>
            ) : paginatedPayrolls.map((payroll) => (
              <div 
                className={`payroll-item metal-panel ${payroll.isVerified ? "verified" : ""}`}
                key={payroll.id}
                onClick={() => setSelectedPayroll(payroll)}
              >
                <div className="payroll-header">
                  <h3>{payroll.employeeName}</h3>
                  <span className={`status-badge ${payroll.isVerified ? "verified" : "pending"}`}>
                    {payroll.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                  </span>
                </div>
                <div className="payroll-details">
                  <div className="detail-item">
                    <span>Hours:</span>
                    <strong>{payroll.publicHours}h</strong>
                  </div>
                  <div className="detail-item">
                    <span>Performance:</span>
                    <strong>{payroll.publicPerformance}/10</strong>
                  </div>
                  <div className="detail-item">
                    <span>Salary:</span>
                    <strong>{payroll.isVerified ? `$${payroll.decryptedValue}` : "🔒 Encrypted"}</strong>
                  </div>
                </div>
                <div className="payroll-meta">
                  <span>{new Date(payroll.timestamp * 1000).toLocaleDateString()}</span>
                  <span>By: {payroll.creator.substring(0, 8)}...</span>
                </div>
              </div>
            ))}
          </div>
          
          {totalPages > 1 && (
            <div className="pagination">
              <button 
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="pagination-btn metal-btn"
              >
                Previous
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button 
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="pagination-btn metal-btn"
              >
                Next
              </button>
            </div>
          )}
        </div>

        <div className="history-section">
          <h3>Operation History</h3>
          <div className="history-list metal-panel">
            {operationHistory.length === 0 ? (
              <p className="no-history">No operations yet</p>
            ) : (
              operationHistory.map((op, index) => (
                <div key={index} className="history-item">
                  {op}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <CreatePayrollModal 
          onSubmit={createPayroll} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingPayroll} 
          payrollData={newPayrollData} 
          setPayrollData={setNewPayrollData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedPayroll && (
        <PayrollDetailModal 
          payroll={selectedPayroll} 
          onClose={() => setSelectedPayroll(null)} 
          decryptSalary={decryptSalary}
          isDecrypting={fheIsDecrypting}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-panel">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner metal-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const CreatePayrollModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  payrollData: any;
  setPayrollData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, payrollData, setPayrollData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'salary') {
      const intValue = value.replace(/[^\d]/g, '');
      setPayrollData({ ...payrollData, [name]: intValue });
    } else {
      setPayrollData({ ...payrollData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal metal-panel">
        <div className="modal-header">
          <h2>Create Encrypted Payroll</h2>
          <button onClick={onClose} className="close-modal metal-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice metal-notice">
            <strong>FHE 🔐 Salary Encryption</strong>
            <p>Salary amount will be encrypted with Zama FHE (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Employee Name *</label>
            <input 
              type="text" 
              name="employeeName" 
              value={payrollData.employeeName} 
              onChange={handleChange} 
              className="metal-input"
              placeholder="Enter employee name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Salary Amount (Integer only) *</label>
            <input 
              type="number" 
              name="salary" 
              value={payrollData.salary} 
              onChange={handleChange} 
              className="metal-input"
              placeholder="Enter salary amount..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">🔐 FHE Encrypted</div>
          </div>
          
          <div className="form-group">
            <label>Work Hours *</label>
            <input 
              type="number" 
              name="hours" 
              value={payrollData.hours} 
              onChange={handleChange} 
              className="metal-input"
              placeholder="Enter work hours..." 
            />
            <div className="data-type-label">Public Data</div>
          </div>
          
          <div className="form-group">
            <label>Performance Score (1-10) *</label>
            <input 
              type="number" 
              min="1" 
              max="10" 
              name="performance" 
              value={payrollData.performance} 
              onChange={handleChange} 
              className="metal-input"
              placeholder="Enter performance score..." 
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !payrollData.employeeName || !payrollData.salary || !payrollData.hours || !payrollData.performance} 
            className="submit-btn metal-btn primary"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Payroll"}
          </button>
        </div>
      </div>
    </div>
  );
};

const PayrollDetailModal: React.FC<{
  payroll: PayrollData;
  onClose: () => void;
  decryptSalary: (id: string) => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ payroll, onClose, decryptSalary, isDecrypting }) => {
  const [localDecrypted, setLocalDecrypted] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (payroll.isVerified) return;
    
    const decrypted = await decryptSalary(payroll.id);
    if (decrypted !== null) {
      setLocalDecrypted(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal metal-panel">
        <div className="modal-header">
          <h2>Payroll Details</h2>
          <button onClick={onClose} className="close-modal metal-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="payroll-info">
            <div className="info-item">
              <span>Employee:</span>
              <strong>{payroll.employeeName}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{payroll.creator.substring(0, 8)}...{payroll.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date:</span>
              <strong>{new Date(payroll.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Salary Information</h3>
            
            <div className="data-grid">
              <div className="data-item public">
                <span>Work Hours</span>
                <strong>{payroll.publicHours}h</strong>
              </div>
              
              <div className="data-item public">
                <span>Performance</span>
                <strong>{payroll.publicPerformance}/10</strong>
              </div>
              
              <div className={`data-item ${payroll.isVerified ? 'verified' : 'encrypted'}`}>
                <span>Salary Amount</span>
                <strong>
                  {payroll.isVerified ? 
                    `$${payroll.decryptedValue}` : 
                    localDecrypted ? 
                    `$${localDecrypted} (Decrypted)` : 
                    "🔒 Encrypted"
                  }
                </strong>
                {payroll.isVerified && <span className="verification-badge">✅ Verified</span>}
                {localDecrypted && !payroll.isVerified && <span className="verification-badge">🔓 Local</span>}
              </div>
            </div>
            
            {!payroll.isVerified && (
              <button 
                className={`decrypt-btn metal-btn ${localDecrypted ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : 
                 localDecrypted ? "Re-verify" : 
                 "🔓 Decrypt Salary"}
              </button>
            )}
          </div>
          
          <div className="fhe-explanation">
            <h4>FHE Encryption Process</h4>
            <div className="process-steps">
              <div className="step">
                <span>1</span>
                <p>Salary encrypted client-side using Zama FHE</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Encrypted data stored on-chain</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Authorized parties can decrypt with proof</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn metal-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;


