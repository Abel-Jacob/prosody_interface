import sys

def check_duplicate_clusters(filename):
    with open(filename, 'rb') as f:
        data = f.read()
    
    cluster_id = b'\x1F\x43\xB6\x75'
    
    idx = 0
    cluster_positions = []
    while True:
        idx = data.find(cluster_id, idx)
        if idx == -1:
            break
        cluster_positions.append(idx)
        idx += 4
        
    clusters = []
    for i in range(len(cluster_positions)):
        start = cluster_positions[i]
        end = cluster_positions[i+1] if i + 1 < len(cluster_positions) else len(data)
        clusters.append(data[start:end])
        
    print(f"Total clusters: {len(clusters)}")
    for i in range(2, 6):
        if i < len(clusters):
            print(f"Cluster {i+1} hash: {hash(clusters[i])}, size: {len(clusters[i])}")
            if i > 0:
                print(f"Same as previous? {clusters[i] == clusters[i-1]}")

if __name__ == '__main__':
    check_duplicate_clusters(sys.argv[1])
